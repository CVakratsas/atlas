/*
 * Atlas: pick a mode, pick a region, find the places.
 *
 * This component owns game state and the screen it is on. The globe owns rendering and
 * input and is driven through the imperative handle in useGlobe - nothing here runs per
 * frame, and the timer updates its own node rather than re-rendering the HUD.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadAtlasData, loadStatesData, flagUrl, type AtlasData, type StatesData } from './data/load';
import { useGlobe, hasWebGL } from './globe/useGlobe';
import { scopeHue, US_HUE } from './globe/palette';
import { MODES, US_MODES, buildRound, isStateMode, type Mode, type Prompt } from './game/round';
import { SCOPES, US_SCOPE, countriesInScope, scopeByName } from './game/scopes';
import {
  accuracy, click as applyClick, currentTarget, skip as skipPrompt, startRound,
  type RoundState,
} from './game/scoring';
import { bestKey, formatTime, load as loadSaved, record, save, type Saved } from './game/storage';
import s from './ui/Game.module.css';

type Screen = 'home' | 'scope' | 'usModes' | 'playing' | 'results';
interface Feedback { kind: 'right' | 'wrong' | 'info'; text: string; at: number }
interface Finished { timeMs: number; newBest: boolean; bestMs: number }

const modeTitle = (m: Mode): string =>
  [...MODES, ...US_MODES].find((x) => x.id === m)?.title ?? '';

export function App() {
  const [data, setData] = useState<AtlasData | null>(null);
  const [geo, setGeo] = useState<unknown>(null);
  const [borderClasses, setBorderClasses] =
    useState<{ classes: string[][]; radii: Record<string, number> } | null>(null);
  const [states, setStates] = useState<StatesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webgl] = useState(hasWebGL);

  const [screen, setScreen] = useState<Screen>('home');
  const [mode, setMode] = useState<Mode>('countries');
  const [scope, setScope] = useState<string>('Europe');
  const [round, setRound] = useState<RoundState | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saved, setSaved] = useState<Saved>(() => loadSaved());
  const [finished, setFinished] = useState<Finished | null>(null);
  const [quitArmed, setQuitArmed] = useState(false);

  const startedAt = useRef(0);
  /* False while the globe is still flying in. Taps are ignored and the clock reads 00:00
   * until it lands - otherwise the HUD showed a stale time from the previous round, and a
   * tap during the flight was scored against it. */
  const landed = useRef(false);
  const timerNode = useRef<HTMLSpanElement | null>(null);
  const roundRef = useRef<RoundState | null>(null);
  roundRef.current = round;
  const quitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const url = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;
    Promise.all([
      loadAtlasData(),
      fetch(url('world-simplified.geojson')).then((r) => r.json()),
      fetch(url('borders.json')).then((r) => r.json()),
      // The US layer is optional: if it fails, the world game still plays.
      loadStatesData().catch(() => null),
    ])
      .then(([d, g, b, st]) => { setData(d); setGeo(g); setBorderClasses(b); setStates(st); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const stateRound = isStateMode(mode);

  const playable = useMemo(() => new Set([
    ...(data?.quizzable ?? []).map((c) => c.iso),
    ...(states?.quizzable ?? []).map((st) => st.iso),
  ]), [data, states]);
  const isPlayable = useCallback((iso: string) => playable.has(iso), [playable]);

  const nameOf = useCallback(
    (iso: string) => data?.byIso.get(iso)?.name ?? states?.byIso.get(iso)?.name ?? iso,
    [data, states]);

  const hue = scopeHue(scope);

  // --- clicks from the globe ------------------------------------------------
  const onPick = useCallback((iso: string | null) => {
    const cur = roundRef.current;
    if (!cur || cur.done || !landed.current) return;
    const now = performance.now() - startedAt.current;
    const inRound = new Set(cur.order);
    const { state, result } = applyClick(cur, iso, now, isPlayable, (i) => inRound.has(i));
    if (result.kind === 'ignored') {
      if (result.reason === 'out-of-round') {
        setFeedback({ kind: 'info', text: `${nameOf(result.iso)} isn't in this round`, at: Date.now() });
      }
      return;
    }

    setRound(state);
    if (result.kind === 'correct') {
      setFeedback({ kind: 'right', text: `+${result.gained}`, at: Date.now() });
      scene.current?.markFound(result.iso);
      scene.current?.hideReveal();
    } else {
      setFeedback({ kind: 'wrong', text: `That's ${nameOf(result.iso)}`, at: Date.now() });
      scene.current?.flashWrong(result.iso);
    }
    if (state.done) finish(state);
  }, [isPlayable, nameOf]);

  const { mount, scene } = useGlobe({ data, geo, borderClasses, states, onPick });

  // --- the timer, kept out of React's render path ---------------------------
  useEffect(() => {
    if (screen !== 'playing') return;
    const id = setInterval(() => {
      if (!timerNode.current) return;
      timerNode.current.textContent =
        landed.current ? formatTime(performance.now() - startedAt.current) : '00:00';
    }, 100);
    return () => clearInterval(id);
  }, [screen]);

  // --- flow -----------------------------------------------------------------
  const disarmQuit = () => {
    if (quitTimer.current) clearTimeout(quitTimer.current);
    quitTimer.current = null;
    setQuitArmed(false);
  };

  const chooseMode = (m: Mode) => { setMode(m); setScreen('scope'); };

  /** Start a round. The globe travels here, on the click - never on hover. */
  const begin = async (m: Mode, scopeName: string) => {
    if (!data) return;
    const statesGame = isStateMode(m);
    if (statesGame && !states) return;
    setMode(m);
    setScope(scopeName);
    disarmQuit();
    const sc = scopeByName(scopeName);
    const built = buildRound({
      mode: m, scope: scopeName, all: data.all,
      ...(statesGame && states ? { pool: states.quizzable } : {}),
      seed: String(Date.now()), missCounts: saved.misses,
    });
    const state = startRound(built.map((p) => p.iso), 0);
    setPrompts(built);
    setRound(state);
    roundRef.current = state;
    setFeedback(null);
    setFinished(null);
    landed.current = false;
    if (timerNode.current) timerNode.current.textContent = '00:00';

    const h = scopeHue(scopeName);
    const inScope = new Set(built.map((p) => p.iso));
    scene.current?.setLayer(statesGame ? 'states' : 'world');
    scene.current?.setOverlay(inScope, new Set(), h);
    // Borders exist for the region being played and nowhere else.
    scene.current?.setBorderScope(inScope);
    setScreen('playing');
    await scene.current?.flyTo(sc.bounds);
    // The clock starts when the planet has come to rest, not while it is still moving.
    startedAt.current = performance.now();
    landed.current = true;
  };

  const finish = (state: RoundState) => {
    const elapsed = performance.now() - startedAt.current;
    landed.current = false;
    const key = bestKey(mode, scope);
    const before = saved.best[key];
    const next = record(saved, mode, scope, elapsed, state.score, state.missed);
    setSaved(next);
    save(next);
    setFinished({
      timeMs: elapsed,
      newBest: !before || elapsed < before.timeMs,
      bestMs: next.best[key]?.timeMs ?? elapsed,
    });
    scene.current?.hideReveal();
    setScreen('results');
  };

  const home = () => {
    disarmQuit();
    setScreen('home');
    setRound(null);
    roundRef.current = null;
    landed.current = false;
    scene.current?.setOverlay(new Set(), new Set(), hue);
    scene.current?.setBorderScope(null);
    scene.current?.setLayer('world');
    scene.current?.hideReveal();
    void scene.current?.reset();
  };

  /*
   * Quit takes two taps. One stray tap on a phone used to throw away a whole round with
   * no way back; the first tap now asks, and the question withdraws itself after 3s.
   */
  const onQuit = () => {
    if (quitArmed) { home(); return; }
    setQuitArmed(true);
    quitTimer.current = setTimeout(() => setQuitArmed(false), 3000);
  };
  useEffect(() => () => { if (quitTimer.current) clearTimeout(quitTimer.current); }, []);

  const onSkip = () => {
    const cur = roundRef.current;
    if (!cur || !landed.current) return;
    const wasTarget = currentTarget(cur);
    const next = skipPrompt(cur, performance.now() - startedAt.current);
    setRound(next);
    setFeedback({ kind: 'wrong', text: `That was ${nameOf(wasTarget ?? '')}`, at: Date.now() });
    // Now - and only now - show where it was. The whole point of the game is that the
    // globe does not tell you in advance.
    if (wasTarget) scene.current?.reveal(wasTarget);
    if (next.done) finish(next);
  };

  const backFromResults = () => setScreen(stateRound ? 'usModes' : 'scope');

  // --- keyboard -------------------------------------------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (screen === 'playing') onQuit();
      else if (screen !== 'home') home();
    } else if (e.key === 'Enter' && screen === 'results') {
      // A focused button already handles Enter itself; only act when nothing is focused.
      if (document.activeElement instanceof HTMLButtonElement) return;
      void begin(mode, scope);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- render ---------------------------------------------------------------
  if (error) return <div className={s.centre}>Could not load map data — {error}</div>;
  if (!webgl) {
    return (
      <div className={s.centre}>
        Atlas needs WebGL to draw the globe.<br />
        Enable hardware acceleration, or try another browser.
      </div>
    );
  }
  if (!data || !geo) return <div className={s.centre}>Loading Atlas</div>;

  const prompt = round && !round.done ? prompts[round.index] : undefined;
  const total = round?.order.length ?? 0;
  const bestFor = (m: Mode, sc: string) => saved.best[bestKey(m, sc)];

  return (
    <div className={s.root} style={{ ['--hue' as string]: hue }}>
      <div className={s.globe} ref={mount} />

      {screen === 'home' && (
        <div className={s.layer}>
          <div className={`${s.home} ${s.fade}`}>
            <h1 className={s.title}>Atlas</h1>
            <p className={s.tagline}>Learn every country, capital and flag in the world.</p>
            <div className={s.modes}>
              {MODES.map((m, i) => (
                <button key={m.id} className={s.card} onClick={() => chooseMode(m.id)}>
                  <span className={s.cardNum}>{String(i + 1).padStart(2, '0')}</span>
                  <h3>{m.title}</h3>
                  <p>{m.blurb}</p>
                </button>
              ))}
              <button
                className={`${s.card} ${s.cardUs}`}
                style={{ ['--card-accent' as string]: US_HUE }}
                onClick={() => setScreen('usModes')}
                disabled={!states}
              >
                <span className={s.cardNum}>04</span>
                <h3>US States</h3>
                <p>{states ? 'All 50 states and their capitals' : 'Unavailable right now'}</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === 'scope' && (
        <div className={s.layer}>
          <div className={`${s.home} ${s.fade}`}>
            <h1 className={`${s.title} ${s.titleSmall}`}>{modeTitle(mode)}</h1>
            <p className={s.tagline}>Choose where to play.</p>
            <div className={s.scopes}>
              {SCOPES.map((sc) => {
                const n = countriesInScope(data.all, sc).length;
                const best = bestFor(mode, sc.name);
                return (
                  <button
                    key={sc.name}
                    className={s.scope}
                    style={{ ['--hue' as string]: scopeHue(sc.name) }}
                    onClick={() => void begin(mode, sc.name)}
                  >
                    {sc.name}
                    <small>{best ? formatTime(best.timeMs) : `${n}`}</small>
                  </button>
                );
              })}
            </div>
            <button className={s.back} onClick={home}>← Back</button>
          </div>
        </div>
      )}

      {screen === 'usModes' && states && (
        <div className={s.layer}>
          <div className={`${s.home} ${s.fade}`} style={{ ['--hue' as string]: US_HUE }}>
            <h1 className={`${s.title} ${s.titleSmall}`}>US States</h1>
            <p className={s.tagline}>Choose what to find.</p>
            <div className={s.scopes}>
              {US_MODES.map((m) => {
                const best = bestFor(m.id, US_SCOPE.name);
                return (
                  <button
                    key={m.id}
                    className={s.scope}
                    style={{ ['--hue' as string]: US_HUE }}
                    onClick={() => void begin(m.id, US_SCOPE.name)}
                    title={m.blurb}
                  >
                    {m.title}
                    <small>{best ? formatTime(best.timeMs) : `${states.quizzable.length}`}</small>
                  </button>
                );
              })}
            </div>
            <button className={s.back} onClick={home}>← Back</button>
          </div>
        </div>
      )}

      {screen === 'playing' && round && (
        <div className={s.layer}>
          <div className={s.hud}>
            <div className={s.stat}>
              <span className={s.statLabel}>Time</span>
              <span className={s.statValue} ref={timerNode}>00:00</span>
            </div>
            <div className={s.stat}>
              <span className={s.statLabel}>Score</span>
              <span className={s.statValue} data-numeric>{round.score.toLocaleString()}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statLabel}>Found</span>
              <span className={`${s.statValue} ${s.hue}`} data-numeric>
                {round.found.length}/{total}
              </span>
            </div>
            <div className={s.spacer} />
            {round.streak > 1 && (
              <div className={`${s.stat} ${s.streakStat}`}>
                <span className={s.statLabel}>Streak</span>
                <span
                  key={round.streak}
                  className={`${s.statValue} ${s.streak} ${s.streakOn}`}
                  data-numeric
                >
                  ×{round.streak}
                </span>
              </div>
            )}
            <button
              className={s.iconBtn}
              onClick={() => void scene.current?.recentre()}
              aria-label="Recentre the map"
              title="Recentre"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                <path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className={`${s.back} ${quitArmed ? s.quitArmed : ''}`}
              onClick={onQuit}
              aria-live="polite"
            >
              {quitArmed ? 'Quit?' : 'Quit'}
            </button>
          </div>

          {prompt && (
            <div className={s.promptWrap}>
              <div className={s.prompt} key={prompt.iso}>
                {/* Grouped so the narrow-screen layout can set the whole prompt on one
                    row beside Skip without needing different markup. */}
                <div className={s.promptMain}>
                  <div className={s.promptSub}>
                    {mode === 'capitals' || mode === 'stateCapitals' ? 'Capital of…'
                      : mode === 'flags' ? 'Whose flag?' : 'Find'}
                  </div>
                  {mode === 'flags'
                    ? <img className={s.promptFlag} src={flagUrl(prompt.iso)} alt="" />
                    : <div className={s.promptLabel}>{prompt.label}</div>}
                </div>
                <div className={`${s.feedback} ${
                  feedback?.kind === 'wrong' ? s.feedbackWrong
                    : feedback?.kind === 'info' ? s.feedbackInfo : s.feedbackRight}`}
                >
                  {feedback?.text ?? ''}
                </div>
                <button className={s.skip} onClick={onSkip}>Skip</button>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === 'results' && round && (
        <div className={s.layer}>
          <div className={`${s.results} ${s.fade}`}>
            <div className={s.resultsScope}>{scope} · {modeTitle(mode)}</div>
            <h2>{round.missed.length === 0 ? 'Perfect round' : 'Round complete'}</h2>
            <div className={s.grid}>
              <div className={s.stat}>
                <span className={s.statLabel}>Time</span>
                <span className={s.statValue} data-numeric>{formatTime(finished?.timeMs ?? 0)}</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>Score</span>
                <span className={s.statValue} data-numeric>{round.score.toLocaleString()}</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>Accuracy</span>
                <span className={s.statValue} data-numeric>{Math.round(accuracy(round) * 100)}%</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>Best streak</span>
                <span className={s.statValue} data-numeric>×{round.bestStreak}</span>
              </div>
            </div>
            {finished && (
              <div className={`${s.best} ${finished.newBest ? s.bestNew : ''}`}>
                {finished.newBest ? 'New best time' : `Best ${formatTime(finished.bestMs)}`}
              </div>
            )}

            {round.missed.length > 0 && (
              <div className={s.missed}>
                <h4>Worth another look</h4>
                <div className={s.chips}>
                  {round.missed.map((iso) => (
                    <span className={s.chip} key={iso}>{nameOf(iso)}</span>
                  ))}
                </div>
              </div>
            )}

            <div className={s.actions}>
              <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => void begin(mode, scope)}>
                Play again
              </button>
              <button className={s.btn} onClick={backFromResults}>
                {stateRound ? 'Change mode' : 'Change region'}
              </button>
              <button className={s.btn} onClick={home}>Home</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

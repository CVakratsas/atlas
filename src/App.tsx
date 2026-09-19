/*
 * Atlas: pick a mode, pick a region, find the countries.
 *
 * This component owns game state and the screen it is on. The globe owns rendering and
 * input and is driven through the imperative handle in useGlobe - nothing here runs per
 * frame, and the timer updates its own node rather than re-rendering the HUD.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadAtlasData, flagUrl, type AtlasData } from './data/load';
import { useGlobe, hasWebGL } from './globe/useGlobe';
import { scopeHue } from './globe/palette';
import { MODES, buildRound, type Mode, type Prompt } from './game/round';
import { SCOPES, countriesInScope, scopeByName } from './game/scopes';
import {
  accuracy, click as applyClick, currentTarget, skip as skipPrompt, startRound,
  type RoundState,
} from './game/scoring';
import { bestKey, formatTime, load as loadSaved, record, save, type Saved } from './game/storage';
import s from './ui/Game.module.css';

type Screen = 'home' | 'scope' | 'playing' | 'results';
interface Feedback { kind: 'right' | 'wrong'; text: string; at: number }

export function App() {
  const [data, setData] = useState<AtlasData | null>(null);
  const [geo, setGeo] = useState<unknown>(null);
  const [borderClasses, setBorderClasses] =
    useState<{ classes: string[][]; radii: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webgl] = useState(hasWebGL);

  const [screen, setScreen] = useState<Screen>('home');
  const [mode, setMode] = useState<Mode>('countries');
  const [scope, setScope] = useState<string>('Europe');
  const [round, setRound] = useState<RoundState | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saved, setSaved] = useState<Saved>(() => loadSaved());

  const startedAt = useRef(0);
  const timerNode = useRef<HTMLSpanElement | null>(null);
  const roundRef = useRef<RoundState | null>(null);
  roundRef.current = round;

  useEffect(() => {
    const url = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;
    Promise.all([
      loadAtlasData(),
      fetch(url('world-simplified.geojson')).then((r) => r.json()),
      fetch(url('borders.json')).then((r) => r.json()),
    ])
      .then(([d, g, b]) => { setData(d); setGeo(g); setBorderClasses(b); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const playable = useMemo(
    () => new Set((data?.quizzable ?? []).map((c) => c.iso)), [data]);
  const isPlayable = useCallback((iso: string) => playable.has(iso), [playable]);

  const hue = scopeHue(scope);

  // --- clicks from the globe ------------------------------------------------
  const onPick = useCallback((iso: string | null) => {
    const cur = roundRef.current;
    if (!cur || cur.done) return;
    const now = performance.now() - startedAt.current;
    const { state, result } = applyClick(cur, iso, now, isPlayable);
    if (result.kind === 'ignored') return;

    setRound(state);
    const name = (i: string) => data?.byIso.get(i)?.name ?? i;
    if (result.kind === 'correct') {
      setFeedback({ kind: 'right', text: `+${result.gained}`, at: Date.now() });
      scene.current?.markFound(result.iso);
      scene.current?.hideReveal();
    } else {
      setFeedback({ kind: 'wrong', text: `That's ${name(result.iso)}`, at: Date.now() });
      scene.current?.flashWrong(result.iso);
    }
    if (state.done) finish(state);
  }, [data, isPlayable, hue]);

  const { mount, scene } = useGlobe({ data, geo, borderClasses, onPick });

  // --- the timer, kept out of React's render path ---------------------------
  useEffect(() => {
    if (screen !== 'playing') return;
    const id = setInterval(() => {
      if (timerNode.current) {
        timerNode.current.textContent = formatTime(performance.now() - startedAt.current);
      }
    }, 100);
    return () => clearInterval(id);
  }, [screen]);

  // --- flow -----------------------------------------------------------------
  const chooseMode = (m: Mode) => { setMode(m); setScreen('scope'); };

  const begin = async (scopeName: string) => {
    if (!data) return;
    setScope(scopeName);
    const sc = scopeByName(scopeName);
    const built = buildRound({
      mode, scope: scopeName, all: data.all,
      seed: String(Date.now()), missCounts: saved.misses,
    });
    const state = startRound(built.map((p) => p.iso), 0);
    setPrompts(built);
    setRound(state);
    roundRef.current = state;
    setFeedback(null);

    const h = scopeHue(scopeName);
    const inScope = new Set(built.map((p) => p.iso));
    scene.current?.setOverlay(inScope, new Set(), h);
    // Borders exist for the region being played and nowhere else.
    scene.current?.setBorderScope(inScope);
    setScreen('playing');
    await scene.current?.flyTo(sc.bounds);
    // The clock starts when the planet has come to rest, not while it is still moving.
    startedAt.current = performance.now();
  };

  const finish = (state: RoundState) => {
    const elapsed = performance.now() - startedAt.current;
    const next = record(saved, mode, scope, elapsed, state.score, state.missed);
    setSaved(next);
    save(next);
    scene.current?.hideReveal();
    setScreen('results');
  };

  const home = () => {
    setScreen('home');
    setRound(null);
    roundRef.current = null;
    scene.current?.setOverlay(new Set(), new Set(), hue);
    scene.current?.setBorderScope(null);
    scene.current?.hideReveal();
    void scene.current?.reset();
  };

  const onSkip = () => {
    const cur = roundRef.current;
    if (!cur) return;
    const name = data?.byIso.get(currentTarget(cur) ?? '')?.name;
    const wasTarget = currentTarget(cur);
    const next = skipPrompt(cur, performance.now() - startedAt.current);
    setRound(next);
    setFeedback({ kind: 'wrong', text: `That was ${name}`, at: Date.now() });
    // Now - and only now - show where it was. The whole point of the game is that the
    // globe does not tell you in advance.
    if (wasTarget) scene.current?.reveal(wasTarget);
    if (next.done) finish(next);
  };

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
            </div>
          </div>
        </div>
      )}

      {screen === 'scope' && (
        <div className={s.layer}>
          <div className={`${s.home} ${s.fade}`}>
            <h1 className={s.title} style={{ fontSize: 'clamp(22px, 4vw, 30px)' }}>
              {MODES.find((m) => m.id === mode)!.title}
            </h1>
            <p className={s.tagline}>Choose where to play.</p>
            <div className={s.scopes}>
              {SCOPES.map((sc) => {
                const n = countriesInScope(data.all, sc).length;
                const best = saved.best[bestKey(mode, sc.name)];
                return (
                  <button
                    key={sc.name}
                    className={s.scope}
                    style={{ ['--hue' as string]: scopeHue(sc.name) }}
                    onClick={() => void begin(sc.name)}
                    onMouseEnter={() => scene.current?.flyTo(sc.bounds, { duration: 1100 })}
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
              <div className={s.stat}>
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
            <button className={s.back} onClick={home}>Quit</button>
          </div>

          {prompt && (
            <div className={s.promptWrap}>
              <div className={s.prompt} key={prompt.iso}>
                <div className={s.promptSub}>
                  {mode === 'capitals' ? 'Capital of…' : mode === 'flags' ? 'Whose flag?' : 'Find'}
                </div>
                {mode === 'flags'
                  ? <img className={s.promptFlag} src={flagUrl(prompt.iso)} alt="" />
                  : <div className={s.promptLabel}>{prompt.label}</div>}
                <div className={`${s.feedback} ${feedback?.kind === 'wrong' ? s.feedbackWrong : s.feedbackRight}`}>
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
            <div className={s.resultsScope}>{scope}</div>
            <h2>{round.missed.length === 0 ? 'Perfect round' : 'Round complete'}</h2>
            <div className={s.grid}>
              <div className={s.stat}>
                <span className={s.statLabel}>Time</span>
                <span className={s.statValue} data-numeric>
                  {formatTime(saved.best[bestKey(mode, scope)]?.timeMs ?? 0)}
                </span>
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

            {round.missed.length > 0 && (
              <div className={s.missed}>
                <h4>Worth another look</h4>
                <div className={s.chips}>
                  {round.missed.map((iso) => (
                    <span className={s.chip} key={iso}>{data.byIso.get(iso)?.name ?? iso}</span>
                  ))}
                </div>
              </div>
            )}

            <div className={s.actions}>
              <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => void begin(scope)}>
                Play again
              </button>
              <button className={s.btn} onClick={() => setScreen('scope')}>Change region</button>
              <button className={s.btn} onClick={home}>Home</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

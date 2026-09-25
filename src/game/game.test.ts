import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Country } from '../data/types';
import { buildRound } from './round';
import { countriesInScope, SCOPES, scopeByName } from './scopes';
import { accuracy, click, currentTarget, multiplierFor, skip, speedBonusFor, startRound } from './scoring';

const all = JSON.parse(
  readFileSync(join(process.cwd(), 'public', 'data', 'countries.json'), 'utf8')) as Country[];
const playable = new Set(all.filter((c) => c.quizzable).map((c) => c.iso));
const isPlayable = (iso: string) => playable.has(iso);

describe('scopes', () => {
  it('covers all 197 countries exactly once across the six regional scopes', () => {
    const regional = SCOPES.filter((s) => s.name !== 'World');
    const seen = new Map<string, number>();
    for (const s of regional) {
      for (const c of countriesInScope(all, s)) seen.set(c.iso, (seen.get(c.iso) ?? 0) + 1);
    }
    expect(seen.size).toBe(197);
    const doubled = [...seen.entries()].filter(([, n]) => n > 1);
    expect(doubled).toEqual([]);
  });

  it('splits the Americas so each half fits on a globe face', () => {
    expect(countriesInScope(all, scopeByName('North America'))).toHaveLength(23);
    expect(countriesInScope(all, scopeByName('South America'))).toHaveLength(12);
  });

  it('never includes a non-quizzable entity', () => {
    // Western Sahara is the only one left; Northern Cyprus and Somaliland no longer
    // exist as entities, and Kosovo and Taiwan are now real countries.
    for (const s of SCOPES) {
      const isos = countriesInScope(all, s).map((c) => c.iso);
      for (const banned of ['ESH', 'CYN', 'SOL']) {
        expect(isos, `${banned} in ${s.name}`).not.toContain(banned);
      }
    }
  });

  it('puts Kosovo in Europe and Taiwan in Asia', () => {
    expect(countriesInScope(all, scopeByName('Europe')).map((c) => c.iso)).toContain('KOS');
    expect(countriesInScope(all, scopeByName('Asia')).map((c) => c.iso)).toContain('TWN');
  });
});

describe('buildRound', () => {
  it('asks for every country in the scope exactly once', () => {
    const r = buildRound({ mode: 'countries', scope: 'Europe', all, seed: 'x' });
    expect(r).toHaveLength(46);   // 45 + Kosovo
    expect(new Set(r.map((p) => p.iso)).size).toBe(46);
  });

  it('is deterministic for a seed, and different across seeds', () => {
    const a = buildRound({ mode: 'countries', scope: 'Africa', all, seed: 'seed-a' });
    const b = buildRound({ mode: 'countries', scope: 'Africa', all, seed: 'seed-a' });
    const c = buildRound({ mode: 'countries', scope: 'Africa', all, seed: 'seed-b' });
    expect(a.map((p) => p.iso)).toEqual(b.map((p) => p.iso));
    expect(a.map((p) => p.iso)).not.toEqual(c.map((p) => p.iso));
  });

  it('labels each mode with the right prompt text', () => {
    const names = buildRound({ mode: 'countries', scope: 'Europe', all, seed: 's' });
    const caps = buildRound({ mode: 'capitals', scope: 'Europe', all, seed: 's' });
    const fra = (ps: typeof names) => ps.find((p) => p.iso === 'FRA')!;
    expect(fra(names).label).toBe('France');
    expect(fra(caps).label).toBe('Paris');
  });

  it('brings countries you keep missing forward', () => {
    // Iceland sits wherever the shuffle puts it; with a heavy miss count it should
    // move decisively toward the front.
    const plain = buildRound({ mode: 'countries', scope: 'Europe', all, seed: 'k' });
    const biased = buildRound({
      mode: 'countries', scope: 'Europe', all, seed: 'k', missCounts: { ISL: 6 },
    });
    const before = plain.findIndex((p) => p.iso === 'ISL');
    const after = biased.findIndex((p) => p.iso === 'ISL');
    expect(after).toBeLessThan(before);
  });

  it('has a usable prompt for every country in every mode', () => {
    for (const mode of ['countries', 'capitals', 'flags'] as const) {
      for (const p of buildRound({ mode, scope: 'World', all, seed: 'z' })) {
        expect(p.label, `${p.iso} in ${mode}`).toBeTruthy();
      }
    }
  });
});

describe('scoring', () => {
  const order = ['FRA', 'DEU', 'ITA'];
  const fresh = () => startRound(order, 0);

  it('awards points and advances on a correct click', () => {
    const { state, result } = click(fresh(), 'FRA', 0, isPlayable);
    expect(result.kind).toBe('correct');
    expect(state.score).toBeGreaterThan(100);
    expect(state.found).toEqual(['FRA']);
    expect(currentTarget(state)).toBe('DEU');
  });

  it('does NOT advance the prompt on a wrong click', () => {
    // The whole point: you still have to find France.
    const { state, result } = click(fresh(), 'DEU', 0, isPlayable);
    expect(result.kind).toBe('wrong');
    expect(currentTarget(state)).toBe('FRA');
    expect(state.found).toEqual([]);
    expect(state.index).toBe(0);
  });

  it('deducts for a wrong click and floors the score at zero', () => {
    let s = fresh();
    for (let i = 0; i < 5; i++) s = click(s, 'DEU', 0, isPlayable).state;
    expect(s.score).toBe(0);
    expect(s.wrongCount).toBe(5);
  });

  it('resets the streak on a wrong click but keeps the best', () => {
    let s = fresh();
    s = click(s, 'FRA', 0, isPlayable).state;
    s = click(s, 'ITA', 0, isPlayable).state;   // wrong, target is DEU
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(1);
  });

  it('ignores an ocean click entirely - a misclick is not a mistake', () => {
    const before = fresh();
    const { state, result } = click(before, null, 0, isPlayable);
    expect(result).toEqual({ kind: 'ignored', reason: 'ocean' });
    expect(state).toBe(before);
  });

  it('ignores a click on a country already found', () => {
    const { state } = click(fresh(), 'FRA', 0, isPlayable);
    const after = click(state, 'FRA', 0, isPlayable);
    expect(after.result).toEqual({ kind: 'ignored', reason: 'already-found' });
    expect(after.state).toBe(state);
  });

  it('ignores a click on a non-quizzable entity', () => {
    const { state, result } = click(fresh(), 'ESH', 0, isPlayable);
    expect(result).toEqual({ kind: 'ignored', reason: 'not-playable' });
    expect(state.score).toBe(0);
    expect(state.wrongCount).toBe(0);
  });

  it('caps the streak multiplier at 3', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(10)).toBe(2);
    expect(multiplierFor(100)).toBe(3);
  });

  it('pays a speed bonus that decays to nothing', () => {
    expect(speedBonusFor(0)).toBe(50);
    expect(speedBonusFor(2500)).toBe(25);
    expect(speedBonusFor(5000)).toBe(0);
    expect(speedBonusFor(99999)).toBe(0);
  });

  it('finishes when every country is found', () => {
    let s = fresh();
    for (const iso of order) s = click(s, iso, 0, isPlayable).state;
    expect(s.done).toBe(true);
    expect(currentTarget(s)).toBeNull();
    expect(click(s, 'FRA', 0, isPlayable).result).toEqual({ kind: 'ignored', reason: 'round-over' });
  });

  it('records a skip as missed and moves on', () => {
    const s = skip(fresh(), 0);
    expect(s.missed).toEqual(['FRA']);
    expect(currentTarget(s)).toBe('DEU');
    expect(s.streak).toBe(0);
  });

  it('records the target as missed when you click the wrong country', () => {
    const { state } = click(fresh(), 'DEU', 0, isPlayable);
    expect(state.missed).toEqual(['FRA']);   // feeds the miss counts that reorder later rounds
  });

  it('reports accuracy', () => {
    let s = fresh();
    s = click(s, 'FRA', 0, isPlayable).state;
    s = click(s, 'ITA', 0, isPlayable).state;  // wrong
    expect(accuracy(s)).toBeCloseTo(0.5, 6);
    expect(accuracy(fresh())).toBe(1);
  });
  describe('a tap outside the round', () => {
    const inRound = (iso: string) => order.includes(iso);

    it('costs nothing, keeps the streak, and names what was tapped', () => {
      let s = click(fresh(), 'FRA', 0, isPlayable, inRound).state;   // correct, streak 1
      const { state, result } = click(s, 'EGY', 0, isPlayable, inRound);
      expect(result).toEqual({ kind: 'ignored', reason: 'out-of-round', iso: 'EGY' });
      expect(state).toBe(s);   // untouched: score, streak, missed all as they were
      s = state;
      expect(s.streak).toBe(1);
    });

    it('still makes a wrong country INSIDE the round cost points', () => {
      const s = fresh();
      const wrong = order.find((iso) => iso !== currentTarget(s))!;
      const { result } = click(s, wrong, 0, isPlayable, inRound);
      expect(result.kind).toBe('wrong');
    });

    it('is optional - without the predicate the old rule stands', () => {
      expect(click(fresh(), 'EGY', 0, isPlayable).result.kind).toBe('wrong');
    });
  });
});

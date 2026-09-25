/*
 * The US states layer, checked the same way the countries are: against the shipped data,
 * through the real picker. A state whose marker sits outside it, or that the picker
 * cannot find at its own marker, looks perfectly fine on screen and is unanswerable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPickIndex, countryAt } from '../globe/picking';
import { distanceForBounds, halfFov, angularSpan } from '../globe/orientation';
import { US_SCOPE } from '../game/scopes';
import { buildRound } from '../game/round';
import type { UsState } from './load';

const dir = join(process.cwd(), 'public', 'data');
const meta = JSON.parse(readFileSync(join(dir, 'us-states.json'), 'utf8')) as
  { states: UsState[]; classes: string[][] };
const geo = JSON.parse(readFileSync(join(dir, 'us-states.geojson'), 'utf8'));
const quiz = meta.states.filter((s) => s.quizzable);

describe('US states data', () => {
  it('has exactly the 50 states, and DC drawn but never asked about', () => {
    expect(quiz).toHaveLength(50);
    const dc = meta.states.find((s) => s.postal === 'DC');
    expect(dc?.quizzable).toBe(false);
    expect(dc?.capital).toBeNull();
  });

  it('gives every state one capital, and no capital to two states', () => {
    const caps = quiz.map((s) => s.capital);
    expect(caps.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
    expect(new Set(caps).size).toBe(50);
  });

  it('spot-checks the capitals people get wrong', () => {
    const cap = (postal: string) => quiz.find((s) => s.postal === postal)?.capital;
    expect(cap('WV')).toBe('Charleston');   // not South Carolina's
    expect(cap('ME')).toBe('Augusta');      // not Georgia's
    expect(cap('SC')).toBe('Columbia');
    expect(cap('OH')).toBe('Columbus');
    expect(cap('CA')).toBe('Sacramento');
    expect(cap('NY')).toBe('Albany');
  });

  it('uses ISO 3166-2 codes, which can never collide with a country code', () => {
    for (const s of meta.states) expect(s.iso).toMatch(/^US-[A-Z]{2}$/);
  });

  it('carries border classes for every feature and ring', () => {
    expect(meta.classes).toHaveLength(geo.features.length);
  });
});

describe('picking a state', () => {
  const index = buildPickIndex(geo, quiz.map((s) => ({
    iso: s.iso, labelPoint: s.labelPoint, radius: s.radius,
  })));

  it('finds every state at its own marker', () => {
    const wrong = quiz.filter((s) => countryAt(s.labelPoint[0], s.labelPoint[1], index) !== s.iso);
    expect(wrong.map((s) => s.postal)).toEqual([]);
  });

  it('never answers DC as a state to find', () => {
    const dc = index.features.find((f) => f.iso === 'US-DC');
    expect(dc?.quizzable).toBe(false);
  });
});

describe('the US round', () => {
  it('frames all 50 states, at portrait and desktop shapes', () => {
    for (const aspect of [390 / 844, 1.6, 2.2]) {
      const d = distanceForBounds(US_SCOPE.bounds, aspect, 42);
      const { v, h } = halfFov(42, aspect);
      const span = angularSpan(US_SCOPE.bounds);
      for (const [deg, phi] of [[span.lat, v], [span.lon, h]] as const) {
        const half = (deg / 2) * (Math.PI / 180);
        expect((d - Math.cos(half)) * Math.tan(phi)).toBeGreaterThanOrEqual(Math.sin(half));
      }
    }
  });

  it('asks about states by name, or by capital', () => {
    const pool = quiz.map((s) => ({ iso: s.iso, name: s.name, capital: s.capital }));
    const names = buildRound({ mode: 'states', scope: US_SCOPE.name, pool, seed: 'a' });
    const caps = buildRound({ mode: 'stateCapitals', scope: US_SCOPE.name, pool, seed: 'a' });
    expect(names).toHaveLength(50);
    const co = (r: typeof names) => r.find((p) => p.iso === 'US-CO')!.label;
    expect(co(names)).toBe('Colorado');
    expect(co(caps)).toBe('Denver');
  });
});

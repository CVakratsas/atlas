/*
 * Stage 1's exit criterion: the data is trustworthy.
 *
 * These read the generated files straight off disk. They exist because a data error is
 * invisible in play — the app works perfectly while quietly teaching that Sri Lanka
 * borders India, or asking about a country whose flag will 404 mid-session.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Adjacency, Country } from './types';

const dir = join(process.cwd(), 'public', 'data');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

const all = read<Country[]>('countries.json');
const adjacency = read<Adjacency>('adjacency.json');
const borders = read<{ classes: string[][]; radii: Record<string, number> }>('borders.json');
const geo = read<{
  features: {
    properties: { iso: string; kind: string };
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  }[];
}>('world-simplified.geojson');

const quiz = all.filter((c) => c.quizzable);
const byIso = new Map(all.map((c) => [c.iso, c]));

describe('the entity set', () => {
  it('is exactly 197 quizzable countries', () => {
    // 193 UN members + 2 observers + 2 de facto states. See docs/entity-decisions.md.
    expect(quiz).toHaveLength(197);
  });

  it('quizzes Kosovo and Taiwan, in their geographic regions', () => {
    for (const [iso, continent] of [['KOS', 'Europe'], ['TWN', 'Asia']] as const) {
      const c = byIso.get(iso);
      expect(c, iso).toBeDefined();
      expect(c!.quizzable, iso).toBe(true);
      expect(c!.continent, iso).toBe(continent);
      expect(c!.capital, iso).toBeTruthy();
    }
  });

  it('has absorbed dependent territory out of existence', () => {
    // Northern Cyprus is drawn as Cyprus, Somaliland as Somalia, Hong Kong and Macau as
    // China. If any survives as its own entity, it reappears as an unfilled hole in the
    // country it belongs to - which is exactly how each of these was noticed.
    for (const iso of ['CYN', 'SOL', 'HKG', 'MAC']) {
      expect(all.some((c) => c.iso === iso), `${iso} is still an entity`).toBe(false);
      expect(geo.features.some((f) => f.properties.iso === iso), `${iso} still drawn`).toBe(false);
      expect(adjacency[iso], `${iso} still in the graph`).toBeUndefined();
    }
  });

  it('renders Western Sahara without quizzing it', () => {
    const rendered = all.filter((c) => !c.quizzable).map((c) => c.iso).sort();
    expect(rendered).toEqual(['ESH']);
    expect(byIso.get('ESH')!.note).toBeTruthy();
  });

  it('draws no border between a country and territory that is now part of it', () => {
    // The internal-boundary rule: segments whose owners resolve to one ISO are skipped.
    // Without it, absorbing Hong Kong would leave a line drawn around it - the same bug
    // in a new place, which is what happened with the Green Line through Cyprus.
    const HK = { w: 113.8, s: 22.1, e: 114.4, n: 22.7 };
    let inside = 0;
    geo.features.forEach((f, fi) => {
      if (f.properties.iso !== 'CHN') return;
      const polys = f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as number[][][]]
        : (f.geometry.coordinates as number[][][][]);
      const rings = polys.flat();
      rings.forEach((ring, ri) => {
        const bits = borders.classes[fi]?.[ri] ?? '';
        for (let i = 1; i < ring.length; i++) {
          if (bits[i - 1] !== '1') continue;   // only drawn land borders count
          const [aLon, aLat] = ring[i - 1] as [number, number];
          const [bLon, bLat] = ring[i] as [number, number];
          const within = (lon: number, lat: number) =>
            lon >= HK.w && lon <= HK.e && lat >= HK.s && lat <= HK.n;
          if (within(aLon, aLat) && within(bLon, bLat)) inside++;
        }
      });
    });
    expect(inside, 'land-border segments drawn inside Hong Kong').toBe(0);
  });

  it('gives Cyprus and Somalia their whole territory', () => {
    const span = (iso: string) => {
      let s = 90, n = -90;
      for (const f of geo.features.filter((x) => x.properties.iso === iso)) {
        const polys = f.geometry.type === 'Polygon'
          ? [f.geometry.coordinates as number[][][]]
          : (f.geometry.coordinates as number[][][][]);
        for (const p of polys) for (const [, lat] of p[0]!) { s = Math.min(s, lat!); n = Math.max(n, lat!); }
      }
      return [s, n];
    };
    // The whole island reaches to ~34.6 in the south; the southern republic alone
    // stops at 35.18, which is the bug this replaces.
    const [cs, cn] = span('CYP');
    expect(cs).toBeLessThan(34.7);
    expect(cn).toBeGreaterThan(35.5);
    // Somalia must reach north past Somaliland's territory.
    expect(span('SOM')[1]).toBeGreaterThan(11);
  });

  it('has no duplicate ISO codes', () => {
    expect(new Set(all.map((c) => c.iso)).size).toBe(all.length);
  });

  it('places every country in one of the five continents', () => {
    const valid = new Set(['Europe', 'Africa', 'Asia', 'Americas', 'Oceania']);
    for (const c of quiz) expect(valid, `${c.iso} is in "${c.continent}"`).toContain(c.continent);
  });
});

describe('every quizzable country is actually playable', () => {
  it('has a capital', () => {
    for (const c of quiz) expect(c.capital, `${c.iso} (${c.name})`).toBeTruthy();
  });

  it('has a flag file on disk', () => {
    const missing = quiz.filter((c) => !existsSync(join(dir, 'flags', `${c.iso}.svg`)));
    expect(missing.map((c) => c.iso)).toEqual([]);
  });

  it('has real geometry — every single one', () => {
    // At 50m this is true of all 195, including the microstates that had to be faked
    // as dots at 110m. Markers are now an aid for small countries, not a substitute.
    const drawn = new Set(geo.features.map((f) => f.properties.iso));
    for (const c of quiz) {
      expect(drawn.has(c.iso), `${c.iso} (${c.name}) has no polygon`).toBe(true);
    }
  });

  it('draws exactly the 197 quizzable countries', () => {
    const drawn = new Set(
      geo.features.filter((f) => f.properties.kind === 'quiz').map((f) => f.properties.iso));
    expect(drawn.size).toBe(197);
  });

  it('has a size for every country, so markers can size themselves', () => {
    for (const c of quiz) {
      const r = borders.radii[c.iso];
      expect(r, `${c.iso} has no radius`).toBeGreaterThan(0);
    }
    // Sanity: the scale must be ordered the way the world is.
    expect(borders.radii['VAT']!).toBeLessThan(borders.radii['LUX']!);
    expect(borders.radii['LUX']!).toBeLessThan(borders.radii['FRA']!);
    expect(borders.radii['FRA']!).toBeLessThan(borders.radii['RUS']!);
  });
});

describe('the neighbour graph', () => {
  it('covers every quizzable country', () => {
    for (const c of quiz) expect(adjacency[c.iso], c.iso).toBeDefined();
  });

  it('is symmetric — no one-way land borders', () => {
    for (const [iso, entry] of Object.entries(adjacency)) {
      for (const n of entry.land) {
        expect(adjacency[n]?.land, `${iso} -> ${n} is not mutual`).toContain(iso);
      }
    }
  });

  it('never points at a country we do not have', () => {
    for (const [iso, entry] of Object.entries(adjacency)) {
      for (const n of [...entry.land, ...entry.near.map(([x]) => x)]) {
        expect(byIso.has(n), `${iso} references unknown ${n}`).toBe(true);
      }
    }
  });

  it('is irreflexive', () => {
    for (const [iso, entry] of Object.entries(adjacency)) {
      expect(entry.land).not.toContain(iso);
      expect(entry.near.map(([x]) => x)).not.toContain(iso);
    }
  });

  it('matches known border counts', () => {
    // Brazil is 9 not 10, and France 8, because overseas territories are excluded.
    const expected = { CHN: 14, RUS: 14, BRA: 9, DEU: 9, FRA: 8, ZAF: 6, ITA: 6, POL: 7 };
    for (const [iso, n] of Object.entries(expected)) {
      expect(adjacency[iso]!.land, iso).toHaveLength(n);
    }
  });

  it('keeps enclaves attached to their surrounding country', () => {
    expect(adjacency['LSO']!.land).toEqual(['ZAF']);
    expect(adjacency['SMR']!.land).toEqual(['ITA']);
    expect(adjacency['VAT']!.land).toEqual(['ITA']);
    expect(adjacency['MCO']!.land).toEqual(['FRA']);
  });

  it('does not claim Sri Lanka has a land border with India', () => {
    // world-countries says it does; the Palk Strait and the 50m geometry say otherwise.
    expect(adjacency['LKA']!.land).toEqual([]);
    expect(adjacency['LKA']!.near.map(([iso]) => iso)).toContain('IND');
  });

  it('gives every island nation some notion of "close"', () => {
    for (const c of quiz) {
      const e = adjacency[c.iso]!;
      expect(e.land.length + e.near.length, `${c.iso} (${c.name}) has no neighbours at all`)
        .toBeGreaterThan(0);
    }
  });

  it('never calls something absurdly distant "close"', () => {
    for (const [iso, entry] of Object.entries(adjacency)) {
      for (const [n, km] of entry.near) {
        expect(km, `${iso} -> ${n}`).toBeLessThanOrEqual(3000);
      }
    }
    // The islet filter: New Zealand's nearest neighbour is across the Tasman Sea,
    // not Kiribati via Tokelau.
    expect(adjacency['NZL']!.near[0]![0]).toBe('AUS');
  });
});

describe('label points', () => {
  it('exist for every country', () => {
    for (const c of quiz) {
      const [lon, lat] = adjacency[c.iso]!.labelPoint;
      expect(Number.isFinite(lon) && Number.isFinite(lat), c.iso).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
  });

  it('sit on the main landmass, not on an outlying territory', () => {
    // The naive multipolygon centroid puts these in an ocean. Each box is the
    // country's actual mainland.
    const inside: Record<string, [number, number, number, number]> = {
      USA: [-125, 24, -66, 50],   // continental US, not mid-Pacific via Hawaii/Alaska
      NOR: [4, 57, 32, 71],       // mainland Norway, not Svalbard
      FRA: [-5, 41, 10, 51],      // metropolitan France, not the Atlantic via Guiana
      HRV: [13, 42, 20, 47],      // inside the crescent, not in Bosnia
      CHL: [-76, -56, -66, -17],  // inside the strip, not in Argentina
      NLD: [3, 50, 8, 54],
    };
    for (const [iso, [w, s, e, n]] of Object.entries(inside)) {
      const [lon, lat] = adjacency[iso]!.labelPoint;
      expect(lon, `${iso} lon`).toBeGreaterThanOrEqual(w);
      expect(lon, `${iso} lon`).toBeLessThanOrEqual(e);
      expect(lat, `${iso} lat`).toBeGreaterThanOrEqual(s);
      expect(lat, `${iso} lat`).toBeLessThanOrEqual(n);
    }
  });
});

describe('capitals with more than one answer', () => {
  it('asks the conventional one and accepts the alternatives', () => {
    expect(byIso.get('ZAF')!.capital).toBe('Pretoria');
    expect(byIso.get('ZAF')!.capitalAccept).toEqual(expect.arrayContaining(['Cape Town', 'Bloemfontein']));
    expect(byIso.get('BOL')!.capitalAccept).toContain('La Paz');
    expect(byIso.get('NLD')!.capitalAccept).toContain('The Hague');
  });

  it('never lists the asked capital among the alternatives', () => {
    for (const c of quiz) expect(c.capitalAccept, c.iso).not.toContain(c.capital);
  });
});

describe('distractor inputs', () => {
  it('spreads countries across all five prominence bands', () => {
    const bands = new Set(quiz.map((c) => c.salience));
    expect([...bands].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('has misconception capitals that are not the real answer', () => {
    for (const c of quiz.filter((x) => x.misconception)) {
      expect(c.misconception, c.iso).not.toBe(c.capital);
      expect(c.capitalAccept, c.iso).not.toContain(c.misconception);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bearing, compassWord, directionPhrase, distanceKm, fitViewBox, project, wrapLon } from './geo';
import type { Adjacency } from '../data/types';

const adjacency: Adjacency = JSON.parse(
  readFileSync(join(process.cwd(), 'public', 'data', 'adjacency.json'), 'utf8'));
const at = (iso: string): [number, number] => adjacency[iso]!.labelPoint;

describe('distance', () => {
  it('matches known great-circle distances within 1%', () => {
    // London -> Paris ~344 km, London -> New York ~5570 km
    expect(distanceKm([-0.13, 51.51], [2.35, 48.86])).toBeCloseTo(344, -1);
    expect(distanceKm([-0.13, 51.51], [-74.01, 40.71])).toBeCloseTo(5570, -2);
  });

  it('is zero for a point and itself, and symmetric', () => {
    expect(distanceKm([10, 20], [10, 20])).toBe(0);
    expect(distanceKm([10, 20], [30, -5])).toBeCloseTo(distanceKm([30, -5], [10, 20]), 6);
  });

  it('measures across the antimeridian the short way', () => {
    // 179E to 179W is 2 degrees apart, not 358.
    expect(distanceKm([179, 0], [-179, 0])).toBeLessThan(250);
  });
});

describe('wrapLon', () => {
  it('folds longitudes into [-180, 180)', () => {
    expect(wrapLon(0)).toBe(0);
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(358)).toBe(-2);
  });
});

describe('bearing and compass words', () => {
  it('reads cardinal directions correctly', () => {
    expect(bearing([0, 0], [0, 10])).toBeCloseTo(0, 1);    // north
    expect(bearing([0, 0], [10, 0])).toBeCloseTo(90, 1);   // east
    expect(bearing([0, 0], [0, -10])).toBeCloseTo(180, 1); // south
    expect(bearing([0, 0], [-10, 0])).toBeCloseTo(270, 1); // west
  });

  it('snaps near-cardinal bearings to the cardinal', () => {
    expect(compassWord(0)).toBe('north');
    expect(compassWord(20)).toBe('north');     // within the snap
    expect(compassWord(200)).toBe('south');    // the brief's Slovenia case
    expect(compassWord(45)).toBe('north-east'); // outside it
    expect(compassWord(135)).toBe('south-east');
  });

  it('is stable at the wrap point', () => {
    expect(compassWord(359.9)).toBe('north');
    expect(compassWord(360)).toBe('north');
    expect(compassWord(-1)).toBe('north');
  });

  it("handles the brief's Slovakia/Slovenia case", () => {
    // The brief illustrates this as "Slovenia is further south". The actual bearing is
    // 225.3 degrees - dead-centre south-west, and 221 degrees even capital-to-capital.
    // The brief's phrasing was loose; we say what is true. Widening the cardinal snap
    // far enough to call this "south" would collapse every diagonal into a cardinal.
    expect(directionPhrase(at('SVK'), at('SVN'))).toBe('further south-west');
  });

  it('describes other real misses the way a person would', () => {
    expect(directionPhrase(at('ZMB'), at('ZWE'))).toMatch(/south/);
    expect(directionPhrase(at('NER'), at('NGA'))).toMatch(/south/);
    expect(directionPhrase(at('AUT'), at('AUS'))).toMatch(/a long way/);
  });

  it('does not reverse direction across the antimeridian', () => {
    // Fiji (~178E) to Kiribati (~173W). Kiribati is genuinely east of Fiji; a missing
    // wrap reports west, which is confidently wrong.
    const b = bearing([178, -17.8], [-173, 1.4]);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(90);
  });
});

describe('projection', () => {
  it('flips y for SVG, where y grows downward', () => {
    expect(project(0, 45).y).toBeLessThan(0);   // north is up
    expect(project(0, -45).y).toBeGreaterThan(0);
  });

  it('keeps the equator and prime meridian at the origin', () => {
    expect(project(0, 0)).toEqual({ x: 0, y: -0 });
    expect(project(0, 0, 'robinson').x).toBeCloseTo(0, 6);
  });

  it('compresses high latitudes under Robinson, unlike Mercator which expands them', () => {
    const eq = Math.abs(project(180, 0, 'robinson').x);
    const hi = Math.abs(project(180, 60, 'robinson').x);
    expect(hi).toBeLessThan(eq);
  });

  it('produces a viewBox that contains the continent it frames', () => {
    for (const name of ['Europe', 'Africa', 'Asia', 'Americas', 'Oceania', 'World']) {
      const vb = fitViewBox((
        { Europe: [-25, 34, 45, 71], Africa: [-19, -36, 52, 38], Asia: [25, -11, 150, 78],
          Americas: [-170, -56, -33, 72], Oceania: [110, -48, 180, 0], World: [-180, -58, 180, 84],
        } as Record<string, [number, number, number, number]>)[name]!);
      expect(vb.width, name).toBeGreaterThan(0);
      expect(vb.height, name).toBeGreaterThan(0);
      expect(Number.isFinite(vb.x) && Number.isFinite(vb.y), name).toBe(true);
    }
  });
});

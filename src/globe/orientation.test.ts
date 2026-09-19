/*
 * The orientation maths decides where the globe points. A sign error here sends Europe to
 * the far side of the planet - and because the globe still looks like a globe, nothing
 * about the rendering would tell you.
 *
 * These push the result through the real three.js maths and assert the place actually
 * ends up facing the camera at +Z.
 */
import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import {
  angularSpan, clampPitch, distanceForBounds, halfFov, homeDistance, orientationFor,
  shortestYaw,
} from './orientation';
import { latLonFromLocal } from './picking';

/** The globe's local-space unit vector for a place - the same convention as picking. */
function localVector(lon: number, lat: number): Vector3 {
  const rad = Math.PI / 180;
  const theta = (90 - lat) * rad;
  const phi = (lon + 180) * rad;
  return new Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
  );
}

/** Apply yaw then pitch exactly as GlobeScene does, and return where the place lands. */
function facing(lon: number, lat: number): Vector3 {
  const { yaw, pitch } = orientationFor(lon, lat);
  // Order matters: 'XYZ' composes as Rx * Ry, i.e. YAW FIRST and pitch second, which is
  // what brings a place to the camera. 'YXZ' applies them the other way round and sends
  // anything off the equator to the wrong place entirely.
  const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'XYZ'));
  return localVector(lon, lat).applyQuaternion(q);
}

describe('orientationFor', () => {
  it('brings a place round to face the camera at +Z', () => {
    const places: [string, number, number][] = [
      ['Greenwich', 0, 0],
      ['Europe', 10, 53],
      ['Tokyo', 139.7, 35.7],
      ['Sydney', 151.2, -33.9],
      ['Rio', -43.2, -22.9],
      ['Anchorage', -149.9, 61.2],
      ['Fiji, east of 180', -179.9, -16.2],
      ['Fiji, west of 180', 178.0, -17.8],
      ['far south', 20, -70],
      ['far north', -60, 70],
    ];
    for (const [name, lon, lat] of places) {
      const v = facing(lon, lat);
      expect(v.z, `${name} should face the camera`).toBeCloseTo(1, 5);
      expect(v.x, `${name} x`).toBeCloseTo(0, 5);
      expect(v.y, `${name} y`).toBeCloseTo(0, 5);
    }
  });

  it('agrees with the picking transform - the two must not drift apart', () => {
    // If orientation and picking ever disagree, the globe shows one country and
    // reports another, which is the worst possible failure and invisible on screen.
    for (const [lon, lat] of [[0, 0], [45, 20], [-120, -35], [170, 60]] as [number, number][]) {
      const v = localVector(lon, lat);
      const [gotLon, gotLat] = latLonFromLocal(v.x, v.y, v.z);
      expect(gotLon).toBeCloseTo(lon, 6);
      expect(gotLat).toBeCloseTo(lat, 6);
    }
  });
});

describe('shortestYaw', () => {
  const TAU = Math.PI * 2;

  it('never travels more than half a turn', () => {
    for (let i = 0; i < 200; i++) {
      const from = (Math.random() - 0.5) * 20;
      const to = (Math.random() - 0.5) * 20;
      const result = shortestYaw(from, to);
      expect(Math.abs(result - from)).toBeLessThanOrEqual(Math.PI + 1e-9);
      // and it must still be the same angle, modulo a full turn
      const diff = Math.abs(((result - to) % TAU + TAU) % TAU);
      expect(Math.min(diff, TAU - diff)).toBeLessThan(1e-9);
    }
  });

  it('crosses the wrap point the short way', () => {
    // From just below a full turn to just above zero is a small step forward,
    // not a near-full turn backward. This is the Asia -> Americas case.
    const from = 0.05;
    const to = TAU - 0.05;
    expect(shortestYaw(from, to)).toBeCloseTo(-0.05, 9);
  });
});

describe('distanceForBounds', () => {
  const B = {
    Europe: [-25, 34, 45, 71], Africa: [-19, -36, 52, 38], Asia: [25, -11, 150, 78],
    NorthAmerica: [-170, 7, -52, 72], SouthAmerica: [-82, -56, -34, 13],
    Oceania: [110, -48, 180, 0],
  } as const;

  it('pulls further back for bigger regions', () => {
    const eu = distanceForBounds(B.Europe);
    const af = distanceForBounds(B.Africa);
    const as = distanceForBounds(B.Asia);
    expect(af).toBeGreaterThan(eu);
    expect(as).toBeGreaterThan(eu);
  });

  it('never puts the camera inside the planet', () => {
    for (const b of Object.values(B)) {
      expect(distanceForBounds(b)).toBeGreaterThan(1.3);
    }
  });

  it('stays close enough that a continent is worth looking at', () => {
    for (const b of Object.values(B)) {
      expect(distanceForBounds(b)).toBeLessThan(5);
    }
  });

  /*
   * The reason this file changed: the old fit had `Math.max(1, aspect * 0.8)` in it, which
   * floored the aspect term and framed every portrait window identically. Europe was
   * placed 758px wide in a 390px viewport - so the game could name a country that was not
   * on the screen, which is the one thing a find-the-country game cannot do.
   */
  const ALL = { ...B, World: [-180, -58, 180, 84] } as const;
  const PORTRAIT = 390 / 844;
  const FOV = 42;

  it('actually fits the region on screen, at any shape of window', () => {
    for (const aspect of [0.42, PORTRAIT, 0.75, 1, 1.6, 2.2]) {
      const { v, h } = halfFov(FOV, aspect);
      for (const [name, b] of Object.entries(ALL)) {
        const d = distanceForBounds(b, aspect, FOV);
        const span = angularSpan(b);
        // The far edge of the arc sits at depth cos(half), sin(half) off the axis.
        for (const [axis, deg, phi] of [['lat', span.lat, v], ['lon', span.lon, h]] as const) {
          const half = (deg / 2) * (Math.PI / 180);
          const room = (d - Math.cos(half)) * Math.tan(phi);
          expect(room, `${name} ${axis} at aspect ${aspect}`)
            .toBeGreaterThanOrEqual(Math.sin(half));
        }
      }
    }
  });

  it('pulls further back as the window narrows', () => {
    for (const b of Object.values(ALL)) {
      expect(distanceForBounds(b, PORTRAIT)).toBeGreaterThan(distanceForBounds(b, 1.6));
    }
  });

  it('leaves the desktop framing where it was', () => {
    // What the previous empirical fit produced. Replacing it with real frustum maths is
    // only worth doing if the view people already have does not lurch.
    const before: Record<string, number> = {
      Europe: 2.11, Africa: 2.59, Asia: 2.81,
      NorthAmerica: 2.65, SouthAmerica: 2.52, Oceania: 2.21,
    };
    for (const [name, b] of Object.entries(B)) {
      const now = distanceForBounds(b, 1.6);
      expect(Math.abs(now - before[name]!) / before[name]!, name).toBeLessThan(0.1);
    }
  });
});

describe('homeDistance', () => {
  it('reproduces the 3.45 it replaces, at the aspect that constant was chosen for', () => {
    expect(homeDistance(1.6)).toBeCloseTo(3.46, 2);
  });

  it('pulls back on a portrait window, where the globe used to overflow the width', () => {
    // At 3.45 on a 390px-wide screen the globe drew 898px across and read as a wall of
    // texture rather than a planet.
    expect(homeDistance(390 / 844)).toBeGreaterThan(6);
  });

  it('fits the whole planet inside the narrower axis, with room to spare', () => {
    for (const aspect of [0.42, 0.46, 1, 1.6, 2.2]) {
      const d = homeDistance(aspect);
      const { v, h } = halfFov(42, aspect);
      // The globe subtends asin(1/d); it must sit inside both half-angles.
      expect(Math.asin(1 / d)).toBeLessThan(Math.min(v, h));
    }
  });
});

describe('clampPitch', () => {
  it('stops the globe tipping past the poles', () => {
    expect(clampPitch(3)).toBeLessThan(1.45);
    expect(clampPitch(-3)).toBeGreaterThan(-1.45);
    expect(clampPitch(0.5)).toBeCloseTo(0.5, 9);
  });
});

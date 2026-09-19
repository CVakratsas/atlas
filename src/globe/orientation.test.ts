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
import { clampPitch, distanceForBounds, orientationFor, shortestYaw } from './orientation';
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
});

describe('clampPitch', () => {
  it('stops the globe tipping past the poles', () => {
    expect(clampPitch(3)).toBeLessThan(1.45);
    expect(clampPitch(-3)).toBeGreaterThan(-1.45);
    expect(clampPitch(0.5)).toBeCloseTo(0.5, 9);
  });
});

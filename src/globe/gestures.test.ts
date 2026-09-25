/*
 * The gesture maths is tested through the real three.js projection, because the bug it
 * fixes - a planet that runs away from your finger - was invisible to any test that
 * checked numbers against themselves.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  INERTIA, capVelocity, dragRadiansPerPixel, inertiaStep, wheelFactor, yawRadiansPerPixel, zoomTo,
} from './gestures';
import { Euler, Quaternion } from 'three';
import { apparentRadiusPx } from './screen';

const FOV = 42;

/** Where the point of the globe facing the camera lands, in px from centre, after a yaw. */
function screenXAfterYaw(yaw: number, distance: number, heightPx: number, aspect: number): number {
  const cam = new PerspectiveCamera(FOV, aspect, 0.1, 100);
  cam.position.set(0, 0, distance);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  // The front point (0,0,1), carried round by a rotation about +Y.
  const p = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).project(cam);
  return (p.x * heightPx * aspect) / 2;
}

describe('dragRadiansPerPixel', () => {
  it('keeps the surface under the finger: a 20px drag moves the planet 20px', () => {
    // Phone framing Europe, desktop framing Europe, and the home views.
    for (const [d, h, aspect] of [[3.78, 844, 390 / 844], [1.99, 900, 1.6], [7.14, 844, 390 / 844], [3.46, 900, 1.6]]) {
      const yaw = 20 * dragRadiansPerPixel(d!, FOV, h!);
      expect(screenXAfterYaw(yaw, d!, h!, aspect!)).toBeCloseTo(20, 0);
    }
  });

  it('holds the ground under the finger at mid latitudes too, not just the equator', () => {
    // Europe is framed with the globe pitched to 52N. A plain yaw there moved the map
    // only 63% as far as the finger; the pitch correction brings it back to 1:1.
    const d = 3.78, h = 844, aspect = 390 / 844, pitch = 52 * Math.PI / 180;
    const cam = new PerspectiveCamera(FOV, aspect, 0.1, 100);
    cam.position.set(0, 0, d); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    // The point facing the camera, in the globe's own frame, is the one at latitude=pitch.
    const local = new Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const at = (yaw: number) => local.clone()
      .applyQuaternion(new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'XYZ')))
      .project(cam).x * h * aspect / 2;
    const yaw = 20 * yawRadiansPerPixel(d, FOV, h, pitch);
    expect(at(yaw) - at(0)).toBeCloseTo(20, 0);
  });

  it('caps the correction near the poles, so a drag there cannot spin the planet', () => {
    const k = dragRadiansPerPixel(3, FOV, 844);
    expect(yawRadiansPerPixel(3, FOV, 844, 89 * Math.PI / 180) / k).toBeLessThan(3);
  });

  it('gears down as you zoom in, so close-up work is not twitchy', () => {
    expect(dragRadiansPerPixel(1.5, FOV, 844)).toBeLessThan(dragRadiansPerPixel(3.78, FOV, 844));
  });

  it('is far gentler than the fixed gearing it replaced', () => {
    // The old rule: 0.0052 * min(1.4, d / 2.2). At Europe on a phone that was 2.9x the
    // finger; at Europe on a desktop, 5.6x.
    const old = (d: number) => 0.0052 * Math.min(1.4, d / 2.2);
    expect(old(3.78) / dragRadiansPerPixel(3.78, FOV, 844)).toBeGreaterThan(2.5);
    expect(old(1.99) / dragRadiansPerPixel(1.99, FOV, 900)).toBeGreaterThan(5);
  });
});

describe('zoomTo', () => {
  const size = (d: number) => apparentRadiusPx(0.05, d, FOV, 844);

  it('a 2x pinch is a 2x zoom, at any distance', () => {
    for (const d of [7, 3.78, 2, 1.5]) {
      const next = zoomTo(d, 0.5, 1.05, 50);
      expect(size(next) / size(d)).toBeCloseTo(2, 1);
    }
  });

  it('zooming in then out by the same factor lands where it started', () => {
    const d = 3.78;
    expect(zoomTo(zoomTo(d, 0.7, 1.05, 50), 1 / 0.7, 1.05, 50)).toBeCloseTo(d, 9);
  });

  it('never goes inside the planet or past the limits', () => {
    expect(zoomTo(1.4, 0.0001, 1.35, 8)).toBe(1.35);
    expect(zoomTo(6, 100, 1.35, 8)).toBe(8);
  });
});

describe('wheelFactor', () => {
  it('scrolling down zooms out and up zooms in, symmetrically', () => {
    expect(wheelFactor(100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(-100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(100, 0, false) * wheelFactor(-100, 0, false)).toBeCloseTo(1, 9);
  });

  it('treats a line-mode wheel like the pixels it stands for', () => {
    expect(wheelFactor(3, 1, false)).toBeCloseTo(wheelFactor(48, 0, false), 9);
  });

  it('gives a trackpad pinch a usable response', () => {
    // A trackpad pinch sends ctrlKey wheel events of a few px each.
    expect(wheelFactor(-5, 0, true)).toBeLessThan(wheelFactor(-5, 0, false));
  });

  it('caps a single notch, so one click of a coarse wheel cannot leap', () => {
    expect(wheelFactor(5000, 0, false)).toBeCloseTo(wheelFactor(240, 0, false), 9);
  });
});

describe('inertia', () => {
  it('decays to a stop', () => {
    let v = { vx: 2, vy: 0 };
    let steps = 0;
    for (; steps < 1000; steps++) {
      const s = inertiaStep(v.vx, v.vy, 16);
      v = s;
      if (s.done) break;
    }
    expect(steps).toBeLessThan(100);   // well under two seconds at 60fps
  });

  it('glides the same distance at 30fps and at 120fps', () => {
    const glide = (dt: number) => {
      let vx = 1.5, total = 0;
      for (let i = 0; i < 2000; i++) {
        const s = inertiaStep(vx, 0, dt);
        total += s.dx; vx = s.vx;
        if (s.done) break;
      }
      return total;
    };
    expect(glide(33)).toBeCloseTo(glide(8), -1);
  });

  it('caps a hard flick without changing its direction', () => {
    const [vx, vy] = capVelocity(30, 40);
    expect(Math.hypot(vx, vy)).toBeCloseTo(INERTIA.maxSpeed, 9);
    expect(vy / vx).toBeCloseTo(40 / 30, 9);
  });
});

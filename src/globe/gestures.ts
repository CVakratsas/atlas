/*
 * The maths behind dragging, pinching and scrolling the globe. Pure - no three.js, no DOM.
 *
 * Two bugs made the controls feel twitchy, and both were gearing:
 *
 *   DRAG was a fixed 0.0052 rad/px, scaled loosely with distance. The surface under a
 *   finger actually moves 1/pixelsPerWorldUnit rad/px, so the planet ran away from the
 *   finger - 2.9x too fast framing Europe on a phone, 5.6x on a desktop.
 *
 *   ZOOM scaled camera DISTANCE, but what you see scales with ALTITUDE (distance - 1).
 *   Spreading two fingers 2x zoomed 3.1x, and worse the closer you got.
 *
 * Both are now derived from the projection itself, so a drag holds the point under the
 * finger and a 2x pinch is a 2x zoom, at any distance and on any screen.
 */
import { pixelsPerWorldUnit } from './screen';

/**
 * Radians of rotation per pixel of drag, such that the surface point under the pointer
 * stays under it: the globe is grabbed, not flung.
 *
 * Measured at the point of the globe facing the camera, which is where you are almost
 * always dragging. Near the limb the surface is foreshortened and moves a little slower
 * than the finger, which is how a real sphere behaves too.
 */
export function dragRadiansPerPixel(distance: number, fovDeg: number, heightPx: number): number {
  return 1 / pixelsPerWorldUnit(distance, fovDeg, heightPx);
}

/*
 * Yaw turns the globe about its own polar axis, which is tilted toward the camera by the
 * pitch. Ground facing the camera at latitude L sits cos(L) from that axis, so a plain
 * yaw moves it only cos(L) as far as the finger: framing Europe (52N), a 100px drag
 * moved the map 63px. Dividing by cos(pitch) restores the grab.
 *
 * Capped, because near a pole the axis points almost at the camera and the correction
 * runs to infinity - a horizontal drag there would spin the planet. 0.35 allows the full
 * correction up to 70 degrees, which covers every region the game frames.
 */
const MIN_COS = 0.35;

export function yawRadiansPerPixel(
  distance: number, fovDeg: number, heightPx: number, pitchRad: number,
): number {
  return dragRadiansPerPixel(distance, fovDeg, heightPx) / Math.max(MIN_COS, Math.cos(pitchRad));
}

/**
 * Zoom by a factor, applied to ALTITUDE above the surface rather than distance from the
 * centre. Apparent size goes as 1/altitude, so `factor` 0.5 is exactly a 2x zoom in.
 */
export function zoomTo(distance: number, factor: number, min: number, max: number): number {
  const altitude = (distance - 1) * factor;
  return Math.max(min, Math.min(max, 1 + altitude));
}

/**
 * Altitude factor for one wheel event.
 *
 * Exponential, so scrolling in and back out by the same amount lands where it started.
 * `deltaMode` 1 is lines (Firefox with a mouse wheel), 2 is pages. A Mac trackpad pinch
 * arrives as a wheel event with `ctrlKey` set and much smaller deltas, so it gets a
 * stronger response - otherwise a trackpad pinch barely moves.
 */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  // Clamp one event's effect: some mice report a single notch as hundreds of pixels.
  const d = Math.max(-240, Math.min(240, px));
  return Math.exp(d * (ctrlKey ? 0.01 : 0.0015));
}

/** Momentum: how long a flick keeps gliding, and how fast it may start. */
export const INERTIA = {
  /** Exponential decay time constant. Total glide = release speed x this. Short on
   *  purpose: the complaint was over-sensitivity, so a flick coasts, it does not sail. */
  tauMs: 110,
  /** px/ms. A hard flick is capped here so it can never spin the planet away. */
  maxSpeed: 2,
  /** Below this, stop - an endless crawl reads as the globe drifting on its own. */
  minSpeed: 0.02,
} as const;

/** Clamp a release velocity (px/ms, both axes) to the maximum speed, keeping direction. */
export function capVelocity(vx: number, vy: number): [number, number] {
  const s = Math.hypot(vx, vy);
  if (s <= INERTIA.maxSpeed || s === 0) return [vx, vy];
  const k = INERTIA.maxSpeed / s;
  return [vx * k, vy * k];
}

/**
 * Advance momentum by `dtMs`. Returns the new velocity and how far (px) it moved in that
 * step. Frame-rate independent: integrating the exponential exactly rather than stepping
 * it means a 30fps phone glides the same distance as a 120fps one.
 */
export function inertiaStep(
  vx: number, vy: number, dtMs: number,
): { vx: number; vy: number; dx: number; dy: number; done: boolean } {
  const decay = Math.exp(-dtMs / INERTIA.tauMs);
  // Distance travelled over the step = v * tau * (1 - e^{-dt/tau}).
  const travel = INERTIA.tauMs * (1 - decay);
  const nx = vx * decay, ny = vy * decay;
  const done = Math.hypot(nx, ny) < INERTIA.minSpeed;
  return { vx: done ? 0 : nx, vy: done ? 0 : ny, dx: vx * travel, dy: vy * travel, done };
}

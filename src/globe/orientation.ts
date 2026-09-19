/*
 * Where to point the globe so a given place faces the viewer.
 *
 * The camera never moves off +Z; all orientation lives in the Earth group. That keeps the
 * starfield still, so the motion reads as the planet turning rather than the universe
 * swinging around the player.
 *
 * Orientation is held as yaw/pitch rather than a quaternion because drag, autorotation and
 * the fly-to tween all have to compose, and two angles compose trivially. Shortest-path
 * wrapping on yaw (`shortestYaw`) does the job that slerp would otherwise do - without it
 * a trip from Asia to the Americas spins the long way round the planet.
 */

const RAD = Math.PI / 180;

export interface Orientation { yaw: number; pitch: number }

/**
 * Yaw and pitch, in radians, that bring (lon, lat) to face the camera.
 *
 * Derived from the same convention picking.ts documents: a point's azimuth about +Y is
 * -lon, and the camera sits at azimuth +90 degrees. So yaw = -lon - 90, and pitch = lat.
 * Verified in orientation.test.ts by pushing the result through the real three.js maths.
 */
export function orientationFor(lon: number, lat: number): Orientation {
  return { yaw: (-lon - 90) * RAD, pitch: lat * RAD };
}

/** The equivalent of `to` nearest to `from`, so a tween never takes the long way round. */
export function shortestYaw(from: number, to: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return from + d;
}

/**
 * The frustum's half-angles, in radians.
 *
 * three.js's `fov` is the VERTICAL field of view; the horizontal one follows from it and
 * the aspect ratio. Forgetting that is what made this whole file wrong on a phone: at a
 * desktop aspect of 1.6 the horizontal half-angle is 31.6 degrees, and at a portrait
 * 0.46 it is 10.1 - a third as wide, from the same camera at the same distance.
 */
export function halfFov(fovDeg: number, aspect: number): { v: number; h: number } {
  const v = (fovDeg / 2) * RAD;
  return { v, h: Math.atan(Math.tan(v) * aspect) };
}

/**
 * Distance from the centre of a unit sphere at which an arc of angular half-span `half`
 * fits inside a frustum half-angle `phi`.
 *
 * The far edge of the arc sits at depth cos(half) from the centre and sin(half) off the
 * axis, so it is inside the frustum when sin(half) <= (d - cos(half)) * tan(phi).
 */
const fitDistance = (half: number, phi: number): number =>
  Math.cos(half) + Math.sin(half) / Math.tan(phi);

/**
 * How wide and how tall a lon/lat box is, in degrees of arc across the globe's face.
 *
 * A degree of longitude covers less ground away from the equator, so 70 degrees across
 * Europe is a far smaller piece of the globe's face than 70 degrees across Africa.
 */
export function angularSpan(
  bounds: readonly [number, number, number, number],
): { lon: number; lat: number } {
  const [w, s, e, n] = bounds;
  const midLat = Math.abs((s + n) / 2) * RAD;
  return {
    lon: Math.min(160, e - w) * Math.cos(midLat * 0.8),
    lat: Math.min(160, n - s),
  };
}

/** A little air around the region, rather than its edges flush to the frame. */
const MARGIN = 1.12;

/**
 * Camera distance, in Earth radii, that frames a lon/lat box.
 *
 * Both axes are fitted and the further of the two wins, so the whole region is on screen
 * whatever shape the window is. That matters more here than it would in most scenes: a
 * country the game asks for but does not show is unanswerable.
 *
 * This used to be an empirical linear fit with `Math.max(1, aspect * 0.8)` in it, which
 * floored the aspect term and so framed every portrait window identically - Europe was
 * placed 758px wide in a 390px viewport, with half of it off screen.
 */
export function distanceForBounds(
  bounds: readonly [number, number, number, number],
  aspect = 1.6,
  fovDeg = 42,
): number {
  const span = angularSpan(bounds);
  const { v, h } = halfFov(fovDeg, aspect);
  const d = Math.max(
    fitDistance((span.lat / 2) * RAD, v),
    fitDistance((span.lon / 2) * RAD, h),
  );
  // The ceiling has to clear `homeDistance` at portrait aspects, or a wide region cannot
  // be framed at all; the floor keeps the camera outside the planet.
  return Math.min(7.2, Math.max(1.7, d * MARGIN));
}

/**
 * Camera distance for the free-spinning home view: the whole planet, filling about 80% of
 * whichever frustum half-angle is the smaller.
 *
 * The globe's silhouette subtends asin(1/d), so fitting it to a fraction of the frustum
 * inverts to 1/sin. At a desktop aspect of 1.6 this returns 3.460 - which is where the
 * 3.45 that used to be hard-coded in two places came from.
 */
export function homeDistance(aspect: number, fovDeg = 42): number {
  const { v, h } = halfFov(fovDeg, aspect);
  return 1 / Math.sin(Math.min(v, h) * 0.8);
}

export const clampPitch = (p: number): number =>
  Math.max(-80 * RAD, Math.min(80 * RAD, p));

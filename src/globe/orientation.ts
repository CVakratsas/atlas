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
 * Camera distance, in Earth radii, that frames a lon/lat box.
 *
 * The wider the region, the further back the camera sits. Past roughly 140 degrees of
 * span there is nothing useful to frame - you are asking to see more than a hemisphere -
 * which is why the Americas ship as two scopes rather than one.
 *
 * The mapping is empirical rather than derived: the exact framing that looks right
 * depends on field of view and how much margin feels comfortable, and a linear fit over
 * the seven scopes we actually ship is honest about that. The tests pin the properties
 * that matter - monotonic in span, never inside the planet, never so far that a
 * continent is a smudge.
 */
export function angularSpan(
  bounds: readonly [number, number, number, number],
  aspect = 1.6,
): number {
  const [w, s, e, n] = bounds;
  const lonSpan = Math.min(160, e - w);
  const latSpan = Math.min(160, n - s);
  // A degree of longitude covers less ground away from the equator, so 70 degrees across
  // Europe is a far smaller piece of the globe's face than 70 degrees across Africa.
  const midLat = Math.abs((s + n) / 2) * RAD;
  const effectiveLon = lonSpan * Math.cos(midLat * 0.8);
  return Math.max(effectiveLon / Math.max(1, aspect * 0.8), latSpan);
}

export function distanceForBounds(
  bounds: readonly [number, number, number, number],
  aspect = 1.6,
): number {
  const span = angularSpan(bounds, aspect);
  return Math.min(4.0, Math.max(1.7, 1.52 + (span / 180) * 2.6));
}

export const clampPitch = (p: number): number =>
  Math.max(-80 * RAD, Math.min(80 * RAD, p));

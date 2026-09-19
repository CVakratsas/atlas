/*
 * Screen-space maths for the globe. Pure - no three.js, no DOM.
 *
 * This exists so that the size a marker is DRAWN at and the size it can be PRESSED at
 * come from the same number. They used to be unrelated: markers were baked into the
 * equirectangular texture, fixing their size in geography rather than on screen, so they
 * were 3.7px when zoomed out (when you most need to hit them) and 36px when zoomed in
 * (when the real country is already an easy target). The hit radius, meanwhile, was an
 * invented constant that matched neither.
 */

/** Radius the microstate marker is drawn at, in CSS pixels. */
export const MARKER_RADIUS_PX = 9;

/**
 * A found country keeps a badge until it draws bigger than this.
 *
 * Twice the hit-target radius. The point is different from the marker's: a marker exists
 * because a country is too small to CLICK, a badge because it is too small to SEE change
 * colour. The second happens at a larger size than the first - measured, a fill change
 * stops registering below about 6px radius, and in Oceania that is 10 of the 14 countries
 * in a round.
 */
export const BADGE_MAX_PX = 18;

const EARTH_KM = 6371;

/**
 * How many CSS pixels one world unit covers, at the point of the globe facing the camera.
 *
 * The camera sits at `distance` from the centre of a unit sphere, so the near face is
 * `distance - 1` away. At that depth the viewport's half-height spans
 * `(distance - 1) * tan(fov/2)` world units.
 */
export function pixelsPerWorldUnit(distance: number, fovDeg: number, heightPx: number): number {
  const depth = Math.max(0.05, distance - 1);
  const halfSpan = depth * Math.tan((fovDeg / 2) * (Math.PI / 180));
  return (heightPx / 2) / halfSpan;
}

/** How big a country of this angular radius appears, in CSS pixels. */
export function apparentRadiusPx(
  angularRadiusRad: number, distance: number, fovDeg: number, heightPx: number,
): number {
  return Math.sin(Math.min(angularRadiusRad, Math.PI / 2))
    * pixelsPerWorldUnit(distance, fovDeg, heightPx);
}

/** Ground distance, in km, that a screen radius corresponds to at this zoom. */
export function kmForPixels(
  px: number, distance: number, fovDeg: number, heightPx: number,
): number {
  return (px / pixelsPerWorldUnit(distance, fovDeg, heightPx)) * EARTH_KM;
}

/*
 * Hide the marker once the country is comfortably bigger than the marker itself.
 *
 * A wide band looks safe but misbehaves: a marker latched on at the home view stays lit
 * all the way into a continent, so countries visibly larger than their own marker keep
 * one. 1.25 is enough to stop flicker at the threshold without over-marking.
 */
const HIDE_FACTOR = 1.25;

/**
 * Whether a country needs a marker: true while its own shape would draw no bigger than
 * the marker would.
 *
 * `wasVisible` supplies hysteresis. Without it a country sitting exactly at the threshold
 * flickers on and off as the camera drifts, which is far more distracting than either
 * state on its own.
 */
export function markerVisible(
  angularRadiusRad: number,
  distance: number,
  fovDeg: number,
  heightPx: number,
  wasVisible = true,
): boolean {
  const r = apparentRadiusPx(angularRadiusRad, distance, fovDeg, heightPx);
  if (wasVisible) return r < MARKER_RADIUS_PX * HIDE_FACTOR;
  return r < MARKER_RADIUS_PX;
}

/**
 * Whether a FOUND country still needs a badge to show that it has been found.
 *
 * Applies the same hysteresis at the wider threshold, so a badge does not flicker as the
 * camera drifts across it.
 */
export function badgeVisible(
  angularRadiusRad: number,
  distance: number,
  fovDeg: number,
  heightPx: number,
  wasVisible = true,
): boolean {
  const r = apparentRadiusPx(angularRadiusRad, distance, fovDeg, heightPx);
  if (wasVisible) return r < BADGE_MAX_PX * HIDE_FACTOR;
  return r < BADGE_MAX_PX;
}

/**
 * The single rule for whether a country's point is drawn at all: it is either too small
 * to click, or found and too small to read as green.
 */
export function pointVisible(
  angularRadiusRad: number,
  found: boolean,
  distance: number,
  fovDeg: number,
  heightPx: number,
  wasVisible = false,
): boolean {
  if (markerVisible(angularRadiusRad, distance, fovDeg, heightPx, wasVisible)) return true;
  return found && badgeVisible(angularRadiusRad, distance, fovDeg, heightPx, wasVisible);
}

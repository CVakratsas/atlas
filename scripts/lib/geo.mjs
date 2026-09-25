/*
 * Geometry helpers shared by the build scripts.
 *
 * Countries and US states are built by different scripts from different Natural Earth
 * files, but they must agree exactly on what a shared border is, how big a place is and
 * where its marker sits - otherwise the two layers of the globe behave differently for no
 * reason anyone could see. So the rules live here, once.
 */

const RAD = Math.PI / 180;

/** Round coordinates to 3 decimal places (~110 m), at the source's own precision. */
const P = 1e3;
export const roundCoords = (c) =>
  Array.isArray(c[0]) ? c.map(roundCoords) : [Math.round(c[0] * P) / P, Math.round(c[1] * P) / P];

/** Every ring of a Polygon or MultiPolygon, holes included. */
export const allRings = (g) =>
  g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];

/** Outer rings only. */
export const outerRings = (g) =>
  g.type === 'Polygon' ? [g.coordinates[0]]
  : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0])
  : [];

/**
 * An undirected key for a segment. Natural Earth is topologically clean, so two places
 * sharing a border carry the identical rounded vertices along it, and this key matches
 * the segment from either side.
 */
export const segmentKey = (a, b) => {
  const ka = `${a[0]},${a[1]}`, kb = `${b[0]},${b[1]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

/** Area of a ring in steradians on the unit sphere (locally equirectangular). */
export function ringAreaSr(ring) {
  let meanLat = 0;
  for (const p of ring) meanLat += p[1];
  meanLat = (meanLat / ring.length) * RAD;
  const kx = Math.cos(meanLat);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xj = ring[j][0] * RAD * kx, yj = ring[j][1] * RAD;
    const xi = ring[i][0] * RAD * kx, yi = ring[i][1] * RAD;
    a += xj * yi - xi * yj;
  }
  return Math.abs(a / 2);
}

/**
 * Angular radius, in radians, of a place's largest landmass. Decides whether it needs a
 * marker: if its own shape would draw smaller on screen than the marker would, it gets one.
 */
export function angularRadius(geometry) {
  let biggest = 0;
  for (const ring of allRings(geometry)) biggest = Math.max(biggest, ringAreaSr(ring));
  return Number(Math.sqrt(biggest / Math.PI).toFixed(6));
}

// --- label points -------------------------------------------------------------------

export const planarArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
};

export function pointInRing(pt, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Distance from a point to the ring's boundary, negative outside. */
function signedDist(pt, r) {
  let min = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j], [bx, by] = r[i];
    let t = ((pt[0] - ax) * (bx - ax) + (pt[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1);
    t = Math.max(0, Math.min(1, t));
    min = Math.min(min, Math.hypot(pt[0] - (ax + t * (bx - ax)), pt[1] - (ay + t * (by - ay))));
  }
  return pointInRing(pt, r) ? min : -min;
}

/**
 * Pole of inaccessibility of the LARGEST ring — not the multipolygon centroid, which
 * puts the USA in the Pacific, Norway in Svalbard and France in the Atlantic, and lands
 * concave places like Croatia, Chile or Maryland inside a neighbour.
 */
export function labelPoint(rings) {
  const r = rings.reduce((a, b) => (planarArea(b) > planarArea(a) ? b : a));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of r) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  let best = [(minX + maxX) / 2, (minY + maxY) / 2], bestD = signedDist(best, r);
  let step = Math.max(maxX - minX, maxY - minY) / 8;
  for (let pass = 0; pass < 8; pass++) {          // coarse grid, then refine around the winner
    for (let x = best[0] - step * 2; x <= best[0] + step * 2; x += step)
      for (let y = best[1] - step * 2; y <= best[1] + step * 2; y += step) {
        const d = signedDist([x, y], r);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
    step /= 2;
  }
  return [Math.round(best[0] * 1e4) / 1e4, Math.round(best[1] * 1e4) / 1e4];
}

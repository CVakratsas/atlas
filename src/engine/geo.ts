/*
 * Projection, distance and bearing. Pure functions — no Date, no Math.random.
 *
 * Mercator is deliberately absent. It inflates Africa to look smaller than Greenland,
 * and in a tool whose entire purpose is teaching people the shape of the world, that is
 * not a rendering detail — it teaches the wrong thing. Equirectangular is honest about
 * what it distorts; Robinson looks better at world scale and distorts less at the poles.
 */

export type Projection = 'equirectangular' | 'robinson';
export interface Point { x: number; y: number }
/** [west, south, east, north] */
export type Bounds = [number, number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* Robinson is defined by a lookup table at 5-degree intervals, interpolated between.
 * These are Robinson's published values: X is the parallel's length relative to the
 * equator, Y its distance from the equator. */
const ROBINSON_X = [
  1, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962,
  0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const ROBINSON_Y = [
  0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571,
  0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1,
];

function robinson(lon: number, lat: number): Point {
  const i = Math.min(17, Math.floor(Math.abs(lat) / 5));
  const t = (Math.abs(lat) - i * 5) / 5;
  const xs = ROBINSON_X[i]! + (ROBINSON_X[i + 1]! - ROBINSON_X[i]!) * t;
  const ys = ROBINSON_Y[i]! + (ROBINSON_Y[i + 1]! - ROBINSON_Y[i]!) * t;
  return { x: lon * xs, y: 90 * ys * Math.sign(lat || 1) };
}

/** Longitude/latitude to abstract projected units. SVG y grows downward, so y is negated. */
export function project(lon: number, lat: number, projection: Projection = 'equirectangular'): Point {
  const p = projection === 'robinson' ? robinson(lon, lat) : { x: lon, y: lat };
  return { x: p.x, y: -p.y };
}

/** Bounding boxes used to frame each continent. Deliberately generous at the edges. */
export const CONTINENT_BOUNDS: Record<string, Bounds> = {
  Europe: [-25, 34, 45, 71],
  Africa: [-19, -36, 52, 38],
  Asia: [25, -11, 150, 78],
  Americas: [-170, -56, -33, 72],
  Oceania: [110, -48, 180, 0],
  World: [-180, -58, 180, 84],
};

export interface ViewBox { x: number; y: number; width: number; height: number; toString(): string }

/** Projected bounding box for a lon/lat box, padded, as an SVG viewBox. */
export function fitViewBox(bounds: Bounds, projection: Projection = 'equirectangular', pad = 0.04): ViewBox {
  const [w, s, e, n] = bounds;
  // Sample the edges rather than the corners: Robinson's parallels are curved, so the
  // extremes of a box are not always at its corners.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const lon = w + ((e - w) * i) / steps;
    const lat = s + ((n - s) * i) / steps;
    for (const p of [project(lon, s, projection), project(lon, n, projection),
                     project(w, lat, projection), project(e, lat, projection)]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  const padX = (maxX - minX) * pad, padY = (maxY - minY) * pad;
  const box = {
    x: minX - padX, y: minY - padY,
    width: (maxX - minX) + padX * 2, height: (maxY - minY) + padY * 2,
  };
  return { ...box, toString: () => `${box.x} ${box.y} ${box.width} ${box.height}` };
}

/** GeoJSON ring(s) to an SVG path. Coordinates are already lon/lat pairs. */
export function ringsToPath(
  coordinates: number[][][] | number[][][][],
  type: 'Polygon' | 'MultiPolygon',
  projection: Projection = 'equirectangular',
): string {
  const polys = type === 'Polygon'
    ? [coordinates as number[][][]]
    : (coordinates as number[][][][]);
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i] as [number, number];
        const p = project(lon, lat, projection);
        d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      }
      d += 'Z';
    }
  }
  return d;
}

// --- distance and direction ------------------------------------------------------

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Wrap to [-180, 180). Without this, Fiji and Kiribati produce confidently reversed
 *  hints — the difference between "further east" and "further west". */
export const wrapLon = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export function distanceKm(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a, [lon2, lat2] = b;
  const dLat = rad(lat2 - lat1), dLon = rad(wrapLon(lon2 - lon1));
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(clamp(Math.sqrt(h), 0, 1));
}

/** Initial great-circle bearing from a to b, in degrees clockwise from north. */
export function bearing(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a, [lon2, lat2] = b;
  const dLon = rad(wrapLon(lon2 - lon1));
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2))
    - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east',
                 'south', 'south-west', 'west', 'north-west'] as const;
/** Degrees of pull toward a cardinal direction. Slovakia to Slovenia is ~20 degrees off
 *  due south; "further south" is what a person would say, not "south-south-west". */
const CARDINAL_SNAP = 22;

export function compassWord(deg360: number): string {
  const b = ((deg360 % 360) + 360) % 360;
  for (const cardinal of [0, 90, 180, 270]) {
    const diff = Math.min(Math.abs(b - cardinal), 360 - Math.abs(b - cardinal));
    if (diff <= CARDINAL_SNAP) return COMPASS[((cardinal / 45) % 8)]!;
  }
  return COMPASS[Math.round(b / 45) % 8]!;
}

/** "further south", "just north of there", "a long way west" — scaled by distance. */
export function directionPhrase(from: [number, number], to: [number, number]): string {
  const word = compassWord(bearing(from, to));
  const km = distanceKm(from, to);
  if (km < 300) return `just ${word} of there`;
  if (km < 1500) return `further ${word}`;
  return `a long way ${word}`;
}

/*
 * Turning a click on the globe into a country.
 *
 * This is the highest-risk code in the project: a sign error here produces a globe that
 * looks perfect and returns the wrong country on every click. None of it is settled by
 * reasoning - it is pinned by tests against real coordinates in picking.test.ts.
 *
 * THREE.SphereGeometry's UV convention, which the equirectangular textures depend on:
 *   position: x = -r*cos(phi)*sin(theta),  y = r*cos(theta),  z = r*sin(phi)*sin(theta)
 *             phi = u*2PI,  theta = v*PI
 *   texture:  u = (lon+180)/360,  v = (90-lat)/180
 * Substituting gives lon 0 at +X, lon -90 at +Z, and the north pole at +Y. Hence the
 * inverse below uses atan2(-z, x), not atan2(z, x).
 */

export interface PickFeature {
  iso: string;
  quizzable: boolean;
  /** Angular radius, mirrored from the marker data so the override rule is self-contained. */
  radius: number;
  /** [west, south, east, north] - the prefilter that keeps a click O(few) not O(177). */
  bbox: [number, number, number, number];
  /** Outer rings only; holes are not modelled, and no country's hole matters here. */
  rings: number[][][];
}

export interface PickDot {
  iso: string;
  lon: number;
  lat: number;
  /** Angular radius of the country's largest landmass. Decides who may override whom. */
  radius: number;
}

export interface PickIndex {
  /** Sorted by bounding-box area ASCENDING - see buildPickIndex. */
  features: PickFeature[];
  /** The 29 countries with no polygon at this resolution. */
  dots: PickDot[];
}

interface GeoFeature {
  properties: { iso: string; kind: 'quiz' | 'disputed' | 'context' };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

/**
 * Build the lookup index once, at load.
 *
 * `markers` is every country that could ever show a marker - which is all of them, since
 * whether one is drawn depends on the zoom rather than on a fixed list. The picker
 * narrows that to the markers actually on screen at click time.
 *
 * Marker positions come from `labelPoint`: the pole of inaccessibility of the country's
 * LARGEST landmass, which for scattered island nations is a real island, whereas a plain
 * centroid of their territory is open ocean. For Kiribati the two are 3292 km apart.
 */
export function buildPickIndex(
  geo: { features: GeoFeature[] },
  markers: { iso: string; labelPoint: [number, number]; radius: number }[],
): PickIndex {
  const features: PickFeature[] = [];
  for (const f of geo.features) {
    const polys = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates as number[][][]]
      : (f.geometry.coordinates as number[][][][]);
    const rings = polys.map((p) => p[0]!).filter((r) => r && r.length >= 3);
    if (!rings.length) continue;

    let w = 180, s = 90, e = -180, n = -90;
    for (const r of rings) for (const p of r) {
      const lon = p[0]!, lat = p[1]!;
      if (lon < w) w = lon; if (lon > e) e = lon;
      if (lat < s) s = lat; if (lat > n) n = lat;
    }
    features.push({
      iso: f.properties.iso,
      quizzable: f.properties.kind === 'quiz',
      radius: 0,
      bbox: [w, s, e, n],
      rings,
    });
  }
  /* Smallest first. An enclave shares its location with the country around it - Lesotho
   * inside South Africa, San Marino inside Italy - and whichever is tested first wins.
   * Sorting by area means the enclave always does, which is the same outcome as modelling
   * every containing country's holes, for one line instead of a geometry pass. */
  features.sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox));

  const dots = markers.map((m) => ({
    iso: m.iso, lon: m.labelPoint[0], lat: m.labelPoint[1], radius: m.radius,
  }));
  const radiusOf = new Map(dots.map((d) => [d.iso, d.radius]));
  for (const f of features) f.radius = radiusOf.get(f.iso) ?? 0;
  return { features, dots };
}

const bboxArea = ([w, s, e, n]: [number, number, number, number]): number =>
  Math.max(1e-6, (e - w) * (n - s));

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/**
 * A place on the globe as a point in the mesh's LOCAL space.
 *
 * The inverse of latLonFromLocal, and the single definition of the convention that the
 * textures, the border geometry, the camera orientation and the picking all have to
 * agree on. If this and latLonFromLocal ever disagree, the globe shows one country and
 * reports another - so orientation.test.ts asserts they round-trip.
 */
export function sphereVector(lon: number, lat: number, radius = 1): [number, number, number] {
  const theta = (90 - lat) * RAD;
  const phi = (lon + 180) * RAD;
  const s = Math.sin(theta);
  return [
    -Math.cos(phi) * s * radius,
    Math.cos(theta) * radius,
    Math.sin(phi) * s * radius,
  ];
}

/**
 * A point on the unit sphere, in the globe mesh's LOCAL space, to lon/lat.
 * The caller must have already removed the mesh's own rotation and axial tilt by
 * transforming through the inverse of its world matrix - otherwise every result is
 * wrong by however far the globe has spun, which looks fine and plays terribly.
 */
export function latLonFromLocal(x: number, y: number, z: number): [number, number] {
  const r = Math.hypot(x, y, z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, y / r))) * DEG;
  const lon = Math.atan2(-z / r, x / r) * DEG;
  return [lon, lat];
}

/** Standard ray-crossing test. Rings are closed or not; both work. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!;
    const xj = ring[j]![0]!, yj = ring[j]![1]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Great-circle distance in km, for the microstate radius test. */
function distKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  let dLon = (bLon - aLon) * rad;
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  if (dLon < -Math.PI) dLon += 2 * Math.PI;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PickOptions {
  /**
   * How close a click must be to a marker to beat the polygon underneath it, in km.
   * Deliberately tight: at 200 km San Marino's marker swallows Italy's centre and
   * Bahrain's swallows Qatar.
   */
  dotRadiusKm?: number;
  /**
   * A far more generous radius used only when the click hit no polygon at all - i.e.
   * it landed in the sea near an island nation. Tuvalu is four pixels of atoll; without
   * this it is effectively unclickable.
   */
  oceanDotRadiusKm?: number;
  /** When true, disputed and context features are ignored entirely. */
  quizzableOnly?: boolean;
  /**
   * Countries currently showing a marker. Only these may win over the polygon under the
   * click - a country whose own shape is big enough to aim at does not need the help,
   * and letting it interfere steals clicks from its neighbours.
   */
  markedOnly?: ReadonlySet<string>;
}

/**
 * The country at a longitude/latitude, or null for ocean.
 *
 * Order matters, and it changed when the render data moved from 110m to 50m. At 110m the
 * 29 smallest countries had no geometry at all, so their markers had to be tested first
 * or they were unclickable. Now every country has a real polygon, and markers-first is
 * actively wrong: Tonga's marker would steal a click that lands squarely inside Fiji.
 *
 * So: polygons first, smallest country first (which is what lets Monaco beat France and
 * Lesotho beat South Africa without modelling holes). A marker only overrides a polygon
 * when the country underneath is a normal-sized one and the marked country is one of the
 * pixel-wide ones - because at continent zoom, aiming at Monaco and landing in France is
 * a near certainty. A marker never overrides another microstate.
 */
export function countryAt(
  lon: number,
  lat: number,
  index: PickIndex,
  opts: PickOptions = {},
): string | null {
  const { dotRadiusKm = 70, oceanDotRadiusKm = 500, quizzableOnly = false, markedOnly } = opts;

  /** `maxRadius` keeps a big country's marker from stealing a click inside it. */
  const nearestDot = (within: number, maxRadius = Infinity): string | null => {
    let best: string | null = null;
    let bestDist = within;
    for (const d of index.dots) {
      if (markedOnly && !markedOnly.has(d.iso)) continue;
      if (d.radius >= maxRadius) continue;
      const km = distKm(lon, lat, d.lon, d.lat);
      if (km < bestDist) { bestDist = km; best = d.iso; }
    }
    return best;
  };

  let hit: string | null = null;
  for (const f of index.features) {
    if (quizzableOnly && !f.quizzable) continue;
    const [w, s, e, n] = f.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    let inside = false;
    for (const ring of f.rings) {
      if (pointInRing(lon, lat, ring)) { inside = true; break; }
    }
    if (inside) { hit = f.iso; break; }
  }

  if (hit) {
    /* Landed on a country. Only a SMALLER country's marker may argue with that: aiming
     * at Monaco and landing in France is near certain at continent zoom, but France's
     * own marker must never steal a click from inside France. Comparing radii keeps the
     * rule self-contained, so it holds at any zoom and needs no external state. */
    const hitRadius = index.features.find((f) => f.iso === hit)?.radius ?? 0;
    const close = nearestDot(dotRadiusKm, hitRadius);
    return close ?? hit;
  }

  /* Nothing under the click, so it is sea: now be generous, and let a click in the water
   * beside an atoll nation still count as that nation. */
  return nearestDot(oceanDotRadiusKm);
}

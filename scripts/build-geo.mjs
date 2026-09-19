/*
 * Builds the render geometry: public/data/world-simplified.geojson and borders.json.
 *
 * Uses Natural Earth **50m**, not 110m. 110m omits 29 of our 195 countries outright and
 * is visibly coarse once the camera is zoomed to a continent - which is the whole point
 * of a globe you can lean into. 50m carries every country we quiz, including Malta,
 * Singapore, Monaco and the Pacific microstates.
 *
 * Natural Earth ships ~100 properties per feature (every localised name, a dozen ranking
 * fields). We keep one: the ISO code. Coordinates are rounded to 3 decimal places, about
 * 110 m, which is at the source's own precision.
 *
 * borders.json holds the same outlines as flat segment arrays for the line renderer, with
 * each segment classified as an international land border or a coastline. Borders are
 * drawn as geometry rather than painted into a texture so they stay crisp at any zoom;
 * coastline is drawn fainter, because the satellite imagery already shows where the sea
 * is and it is the political boundaries that need to stand out in dense regions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ABSORBED_INTO } from './overrides.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const src = JSON.parse(readFileSync(join(here, '.cache', 'ne_50m_admin_0_countries.geojson'), 'utf8'));
const countries = JSON.parse(readFileSync(join(dataDir, 'countries.json'), 'utf8'));
const known = new Map(countries.map((c) => [c.iso, c]));

/* Absorption is applied here, at the point the code is resolved, so nothing downstream
 * ever sees Northern Cyprus or Somaliland as separate places. */
const neIso = (p) => {
  for (const k of [p.ISO_A3_EH, p.ISO_A3, p.ADM0_A3]) {
    if (k && k !== '-99') return ABSORBED_INTO[k] ?? k;
  }
  return null;
};
const P = 1e3;
const round = (c) => Array.isArray(c[0]) ? c.map(round) : [Math.round(c[0] * P) / P, Math.round(c[1] * P) / P];

/* Three kinds of feature, because they are drawn differently:
 *   quiz     - one of the 195; clickable, the fill carries its state
 *   disputed - Taiwan, Kosovo, Western Sahara, N. Cyprus, Somaliland; drawn and labelled,
 *              never a target
 *   context  - Greenland, Antarctica, the Falklands. Not quizzable and not clickable, but
 *              a world map missing Greenland and Antarctica looks broken. */
const features = [];
const context = [];
for (const f of src.features) {
  const iso = neIso(f.properties);
  const rec = known.get(iso);
  const kind = !rec ? 'context' : rec.quizzable ? 'quiz' : 'disputed';
  if (kind === 'context') context.push(iso ?? f.properties.ADM0_A3);
  features.push({
    type: 'Feature',
    properties: { iso: iso ?? f.properties.ADM0_A3, kind, name: rec?.name ?? f.properties.NAME },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  });
}

const geo = { type: 'FeatureCollection', features };
writeFileSync(join(dataDir, 'world-simplified.geojson'), JSON.stringify(geo, null, 0));

// --- borders: classify every segment ------------------------------------------------
/*
 * A segment shared by two different countries is an international land border; anything
 * else is coastline. Natural Earth is topologically clean at this resolution, so both
 * countries carry the identical rounded vertices along a shared boundary and an undirected
 * key over the endpoint pair matches them. This is the same shared-vertex trick
 * build-adjacency.mjs uses to derive the neighbour graph.
 */
const ringsOf = (g) => g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
const key = (a, b) => {
  const ka = `${a[0]},${a[1]}`, kb = `${b[0]},${b[1]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const owners = new Map();
/* How many times a segment appears at all. Two appearances with one owner means two
 * features of the same country meet there - an internal boundary. */
const counts = new Map();
for (const f of features) {
  const iso = f.properties.iso;
  for (const ring of ringsOf(f.geometry)) {
    for (let i = 1; i < ring.length; i++) {
      const k = key(ring[i - 1], ring[i]);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k).add(iso);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
}
const sharedPairs = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));

/*
 * The classification is stored as one character per ring segment - '1' for an
 * international land border, '0' for coastline - keyed by feature index and ring.
 *
 * Storing the segment coordinates here instead would duplicate the entire geometry we
 * already ship in world-simplified.geojson: 5.5 MB rather than the ~25 KB this costs
 * gzipped. The renderer walks the same rings and splits them into two buffers using
 * these flags.
 */
const classes = [];
let land = 0, coast = 0, dropped = 0, internal = 0;

for (const f of features) {
  const perRing = [];
  for (const ring of ringsOf(f.geometry)) {
    let bits = '';
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      // Degenerate segments, and any ring that jumps the antimeridian - which would
      // otherwise draw a line straight across the face of the globe.
      if ((a[0] === b[0] && a[1] === b[1]) || Math.abs(a[0] - b[0]) > 180) {
        bits += '-'; dropped++; continue;
      }
      /* A segment owned by two features that now carry the SAME code is an internal
       * boundary - the Green Line through Cyprus, or Somaliland's edge. Absorbing the
       * territory without skipping these would draw a faint line straight through the
       * middle of the country, which is the same bug in a new place. */
      const owned = owners.get(key(a, b));
      if (owned.size === 1 && sharedPairs.has(key(a, b))) { bits += '-'; internal++; continue; }
      const shared = owned.size > 1;
      bits += shared ? '1' : '0';
      if (shared) land++; else coast++;
    }
    perRing.push(bits);
  }
  classes.push(perRing);
}

/*
 * Angular radius of each country's largest landmass, in radians on a unit sphere.
 *
 * This is what decides whether a country needs a marker: if its own shape would draw
 * smaller on screen than the marker would, the marker appears. That replaces a
 * hand-maintained list of "small countries", which had no defensible boundary - it put
 * Cape Verde in and Luxembourg out purely because of which ones Natural Earth's 110m set
 * happened to omit.
 */
const RAD = Math.PI / 180;
function ringAreaSr(ring) {
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
const radii = {};
for (const f of features) {
  let biggest = 0;
  for (const ring of ringsOf(f.geometry)) biggest = Math.max(biggest, ringAreaSr(ring));
  const r = Math.sqrt(biggest / Math.PI);
  radii[f.properties.iso] = Math.max(radii[f.properties.iso] ?? 0, Number(r.toFixed(6)));
}

writeFileSync(join(dataDir, 'borders.json'), JSON.stringify({ classes, radii }));

const kb = (n) => `${Math.round(n / 1024)} KB`;
const by = (k) => features.filter((f) => f.properties.kind === k).length;
let verts = 0;
const walk = (c) => Array.isArray(c[0]) ? c.forEach(walk) : verts++;
features.forEach((f) => walk(f.geometry.coordinates));

const uniq = (k) => new Set(features.filter((f) => f.properties.kind === k).map((f) => f.properties.iso)).size;
console.log(`  world-simplified    ${features.length} features, ${verts} vertices, ${kb(JSON.stringify(geo).length)}`);
console.log(`                      ${uniq('quiz')} quizzable countries, ${uniq('disputed')} disputed, ${uniq('context')} context-only`);
console.log(`                      (${features.length} features because Natural Earth splits some countries into several)`);
console.log(`  borders.json        ${land} land-border segments, ${coast} coastline, ${kb(JSON.stringify({ classes }).length)}`);
if (dropped) console.log(`                      ${dropped} degenerate/antimeridian segments skipped`);
if (internal) console.log(`                      ${internal} internal boundaries skipped (absorbed territory)`);

const drawn = new Set(features.map((f) => f.properties.iso));
const noPoly = countries.filter((c) => c.quizzable && !drawn.has(c.iso));
if (noPoly.length) console.log(`  WARNING: no polygon for ${noPoly.map((c) => c.iso).join(', ')}`);
else console.log(`                      all ${countries.filter((c) => c.quizzable).length} quizzable countries have real geometry`);

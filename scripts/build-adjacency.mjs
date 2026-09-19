/*
 * Builds public/data/adjacency.json: the neighbour graph plus a label point per country.
 *
 * Land edges come from world-countries' curated `borders` list and are CROSS-CHECKED
 * against shared-vertex detection on Natural Earth 50m geometry. Either source alone
 * has holes; disagreements are printed so they can be judged rather than absorbed.
 *
 * 50m is used rather than 110m because 110m omits 29 of our 195 countries outright
 * (Malta, Singapore, Monaco, San Marino...). Deriving adjacency from 110m loses every
 * microstate edge silently. Nothing from 50m ships — only this ~30 KB output.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ABSORBED_INTO } from './overrides.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const countries = JSON.parse(readFileSync(join(dataDir, 'countries.json'), 'utf8'));
const ne50 = JSON.parse(readFileSync(join(here, '.cache', 'ne_50m_admin_0_countries.geojson'), 'utf8'));

const fail = (m) => { console.error(`\n  BUILD FAILED: ${m}\n`); process.exit(1); };
/* Absorbed territory resolves to its parent, so Somaliland's borders become Somalia's
 * and the boundary between them disappears rather than becoming a self-edge. */
const neIso = (p) => {
  for (const k of [p.ISO_A3_EH, p.ISO_A3, p.ADM0_A3]) {
    if (k && k !== '-99') return ABSORBED_INTO[k] ?? k;
  }
  return null;
};

const MARITIME_KM = 400;   // within this, "close" regardless of the k-nearest rule
const MAX_NEAR_KM = 3000;  // beyond this nothing counts as close, ever
const K_NEAREST = 3;       // floor, so island nations always have some notion of "near"

// --- geometry helpers -----------------------------------------------------------
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const ringsOf = (geom) =>
  geom.type === 'Polygon' ? [geom.coordinates[0]]
  : geom.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0])
  : [];
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
};
function pointInRing(pt, r) {
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
/* Pole of inaccessibility of the LARGEST ring — not the multipolygon centroid, which
 * puts the USA in the Pacific, Norway in Svalbard and France in the Atlantic, and
 * lands concave countries like Croatia and Chile inside a neighbour. */
function labelPoint(rings) {
  const r = rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
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

// --- index the 50m geometry -----------------------------------------------------
const geom = new Map();
for (const f of ne50.features) {
  const code = neIso(f.properties);
  if (!code) continue;
  const rings = ringsOf(f.geometry);
  if (!rings.length) continue;
  if (geom.has(code)) geom.get(code).push(...rings); else geom.set(code, rings);
}
const known = new Set(countries.map((c) => c.iso));
const missing = countries.filter((c) => !geom.has(c.iso));
if (missing.length) fail(`no 50m geometry for: ${missing.map((c) => c.iso).join(', ')}`);

// --- land edges: curated list, cross-checked against shared vertices --------------
const land = new Map(countries.map((c) => [c.iso, new Set(c.borders.filter((b) => known.has(b)))]));

const vertexOwners = new Map();  // quantised coord -> countries touching it (~11 m grid)
for (const [code, rings] of geom) {
  if (!known.has(code)) continue;
  const seen = new Set();
  for (const r of rings) for (const [x, y] of r) {
    const k = `${Math.round(x * 1e4)}:${Math.round(y * 1e4)}`;
    if (seen.has(k + code)) continue;
    seen.add(k + code);
    if (!vertexOwners.has(k)) vertexOwners.set(k, new Set());
    vertexOwners.get(k).add(code);
  }
}
const shared = new Map();
for (const owners of vertexOwners.values()) {
  if (owners.size < 2) continue;
  const list = [...owners];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const k = [list[i], list[j]].sort().join('|');
    shared.set(k, (shared.get(k) ?? 0) + 1);
  }
}
const derived = new Set([...shared.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
const curated = new Set();
for (const [a, set] of land) for (const b of set) curated.add([a, b].sort().join('|'));
const curatedBefore = curated.size;

/* Reconcile one-directional entries in the curated list against the geometry.
 * Upstream has real errors here — it lists Sri Lanka as bordering India, which the
 * Palk Strait says otherwise and which the 50m geometry confirms. An edge claimed in
 * only one direction is kept only if the polygons actually touch; otherwise it is
 * dropped and demoted to a maritime neighbour. */
const reconciled = [];
for (const [a, set] of land) for (const b of [...set]) {
  if (land.get(b)?.has(a)) continue;
  const k = [a, b].sort().join('|');
  if (derived.has(k)) { land.get(b).add(a); reconciled.push(`+${a}-${b}`); }
  else { set.delete(b); reconciled.push(`-${a}-${b}`); }
}

const onlyCurated = [...curated].filter((k) => !derived.has(k));
const onlyDerived = [...derived].filter((k) => !curated.has(k));

// --- maritime "near" edges --------------------------------------------------------
// Binary adjacency is useless for Japan, Indonesia, Iceland, New Zealand. Sample each
// country's outline (stride-capped for speed; ample against a 400 km threshold).
/* Outlying specks are excluded: Natural Earth files Tokelau and the Kermadecs under
 * New Zealand and Norfolk Island under Australia, which would otherwise make Kiribati
 * a 448 km "neighbour" of New Zealand. Rings smaller than 1% of the country's largest,
 * beyond the 20 biggest, are dropped — that keeps real archipelagos like Indonesia and
 * the Philippines intact while removing islets nobody means when they say "close". */
const sampled = new Map();
for (const [code, rings] of geom) {
  if (!known.has(code)) continue;
  const byArea = rings.map((r) => [r, ringArea(r)]).sort((a, b) => b[1] - a[1]);
  const cutoff = byArea[0][1] * 0.01;
  const keep = byArea.filter(([, a], i) => i < 20 && a >= cutoff).map(([r]) => r);
  const pts = [];
  for (const r of keep) { const stride = Math.max(1, Math.ceil(r.length / 120)); for (let i = 0; i < r.length; i += stride) pts.push(r[i]); }
  sampled.set(code, pts.length ? pts : byArea[0][0]);
}
const centre = new Map(countries.map((c) => [c.iso, labelPoint(geom.get(c.iso))]));

const near = new Map(countries.map((c) => [c.iso, []]));
const codes = countries.map((c) => c.iso);
for (let i = 0; i < codes.length; i++) {
  const a = codes[i];
  const cands = [];
  for (let j = 0; j < codes.length; j++) {
    if (i === j) continue;
    const b = codes[j];
    if (land.get(a).has(b)) continue;                                   // already a land edge
    if (haversine(centre.get(a), centre.get(b)) > MAX_NEAR_KM + 4000) continue;  // cheap reject
    let min = Infinity;
    const pa = sampled.get(a), pb = sampled.get(b);
    for (const p of pa) for (const q of pb) { const d = haversine(p, q); if (d < min) min = d; }
    if (min <= MAX_NEAR_KM) cands.push([b, Math.round(min)]);
  }
  cands.sort((x, y) => x[1] - y[1]);
  const picked = cands.filter(([, d]) => d <= MARITIME_KM);
  for (const c of cands) { if (picked.length >= K_NEAREST) break; if (!picked.includes(c)) picked.push(c); }
  near.set(a, picked.sort((x, y) => x[1] - y[1]));
}

// --- verification ------------------------------------------------------------------
/* Golden degrees. These are the counts our stated policy produces, which is not
 * always the textbook figure: Brazil is 9 rather than the usual 10 because French
 * Guiana is excluded as an overseas territory, and France is 8 (its European
 * neighbours) for the same reason. Spain keeps Morocco — Ceuta and Melilla are
 * integral parts of Spain, not overseas territories. Any drift trips this. */
const GOLDEN = { CHN: 14, RUS: 14, BRA: 9, DEU: 9, FRA: 8, ZAF: 6, ITA: 6, ESP: 4, POL: 7,
                 LSO: 1, SMR: 1, VAT: 1, MCO: 1 };
for (const [code, want] of Object.entries(GOLDEN)) {
  const got = land.get(code)?.size ?? 0;
  if (got !== want) fail(`${code} should have ${want} land neighbours, has ${got}: ${[...land.get(code)].join(',')}`);
}
for (const [a, set] of land) for (const b of set) {
  if (!land.get(b)?.has(a)) fail(`asymmetric land edge: ${a}->${b} but not back`);
}
for (const c of countries) {
  if (!pointInRing(centre.get(c.iso), geom.get(c.iso).reduce((x, y) => (ringArea(y) > ringArea(x) ? y : x))))
    fail(`label point for ${c.iso} falls outside its own polygon`);
}
const islandsWithoutNear = countries.filter((c) => land.get(c.iso).size === 0 && near.get(c.iso).length === 0);
if (islandsWithoutNear.length) fail(`no notion of "close" for: ${islandsWithoutNear.map((c) => c.iso).join(', ')}`);

// --- emit ---------------------------------------------------------------------------
const graph = {};
for (const c of countries.slice().sort((a, b) => a.iso.localeCompare(b.iso))) {
  graph[c.iso] = {
    land: [...land.get(c.iso)].sort(),
    near: near.get(c.iso),
    labelPoint: centre.get(c.iso),
  };
}
writeFileSync(join(dataDir, 'adjacency.json'), JSON.stringify(graph, null, 0));

const landlocked = countries.filter((c) => land.get(c.iso).size === 0).length;
if (reconciled.length) console.log(`  reconciled one-way border claims: ${reconciled.join(', ')}`);
const finalEdges = new Set();
for (const [a, set] of land) for (const b of set) finalEdges.add([a, b].sort().join('|'));
void curatedBefore;
console.log(`  adjacency.json      ${finalEdges.size} land edges, ${[...near.values()].reduce((a, b) => a + b.length, 0)} maritime edges`);
console.log(`                      ${landlocked} countries with no land border; all have maritime neighbours`);
if (onlyCurated.length) console.log(`  curated-only edges (not found in 50m geometry): ${onlyCurated.length} — ${onlyCurated.slice(0, 6).join(', ')}${onlyCurated.length > 6 ? '…' : ''}`);
if (onlyDerived.length) console.log(`  geometry-only edges (not in curated list):      ${onlyDerived.length} — ${onlyDerived.slice(0, 6).join(', ')}${onlyDerived.length > 6 ? '…' : ''}`);

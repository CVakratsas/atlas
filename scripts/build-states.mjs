/*
 * Builds the US states layer: public/data/us-states.geojson and us-states.json.
 *
 * Source: Natural Earth 50m admin-1 (public domain), filtered to the USA - the same
 * resolution the countries use, so state and country lines meet cleanly at the coast.
 *
 * Only the lines BETWEEN states are drawn by this layer. The coast and the Canada and
 * Mexico borders already come from the country layer, which a states round keeps scoped
 * to the USA; drawing them twice from two slightly different sources would double the
 * line and shimmer where they disagree.
 *
 * Fails the build rather than guessing, like build-countries.mjs: exactly 50 quizzable
 * states, each with exactly one capital, no capital claimed twice, every label point
 * inside its own state.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  allRings, angularRadius, labelPoint, outerRings, planarArea, pointInRing, roundCoords, segmentKey,
} from './lib/geo.mjs';
import { NOT_A_STATE, STATE_CAPITALS } from './us-states.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const src = JSON.parse(readFileSync(
  join(here, '.cache', 'ne_50m_admin_1_states_provinces.geojson'), 'utf8'));

const fail = (m) => { console.error(`\n  BUILD FAILED: ${m}\n`); process.exit(1); };

const features = [];
const states = [];
for (const f of src.features) {
  const p = f.properties;
  if (p.adm0_a3 !== 'USA') continue;
  const postal = p.postal;
  const iso = p.iso_3166_2;            // "US-CO": unique, and cannot collide with a country code
  if (!/^US-[A-Z]{2}$/.test(iso ?? '')) fail(`unexpected code ${iso} for ${p.name}`);
  const quiz = !NOT_A_STATE.includes(postal);
  const geometry = { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) };
  features.push({
    type: 'Feature',
    properties: { iso, kind: quiz ? 'quiz' : 'disputed', name: p.name },
    geometry,
  });
  const lp = labelPoint(outerRings(geometry));
  states.push({
    iso, postal, name: p.name, quizzable: quiz,
    capital: quiz ? STATE_CAPITALS[postal] ?? null : null,
    labelPoint: lp,
    radius: angularRadius(geometry),
  });
}

// --- the checks that make this safe to ship ----------------------------------------
const quiz = states.filter((s) => s.quizzable);
if (quiz.length !== 50) fail(`expected 50 states, found ${quiz.length}`);
const noCapital = quiz.filter((s) => !s.capital);
if (noCapital.length) fail(`no capital for ${noCapital.map((s) => s.postal).join(', ')}`);
const known = new Set(states.map((s) => s.postal));
const orphan = Object.keys(STATE_CAPITALS).filter((k) => !known.has(k));
if (orphan.length) fail(`capital table names states not in the geometry: ${orphan.join(', ')}`);
const seen = new Map();
for (const s of quiz) {
  if (seen.has(s.capital)) fail(`${s.capital} claimed by both ${seen.get(s.capital)} and ${s.postal}`);
  seen.set(s.capital, s.postal);
}
for (const f of features) {
  const s = states.find((x) => x.iso === f.properties.iso);
  const biggest = outerRings(f.geometry).reduce((a, b) => (planarArea(b) > planarArea(a) ? b : a));
  if (!pointInRing(s.labelPoint, biggest)) fail(`label point for ${s.name} is outside it`);
}

// --- borders: only segments shared by two states -----------------------------------
const owners = new Map();
for (const f of features) {
  for (const ring of allRings(f.geometry)) {
    for (let i = 1; i < ring.length; i++) {
      const k = segmentKey(ring[i - 1], ring[i]);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k).add(f.properties.iso);
    }
  }
}
let shared = 0, skipped = 0;
const classes = features.map((f) => allRings(f.geometry).map((ring) => {
  let bits = '';
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    const degenerate = (a[0] === b[0] && a[1] === b[1]) || Math.abs(a[0] - b[0]) > 180;
    if (!degenerate && owners.get(segmentKey(a, b)).size > 1) { bits += '1'; shared++; }
    else { bits += '-'; skipped++; }
  }
  return bits;
}));

const pairs = new Set();
for (const o of owners.values()) if (o.size > 1) pairs.add([...o].sort().join('|'));

const geo = { type: 'FeatureCollection', features };
writeFileSync(join(dataDir, 'us-states.geojson'), JSON.stringify(geo));
writeFileSync(join(dataDir, 'us-states.json'), JSON.stringify({
  states: states.sort((a, b) => a.name.localeCompare(b.name)),
  classes,
}));

const kb = (n) => `${Math.round(n / 1024)} KB`;
let verts = 0;
const walk = (c) => Array.isArray(c[0]) ? c.forEach(walk) : verts++;
features.forEach((f) => walk(f.geometry.coordinates));
console.log(`  us-states.geojson   ${features.length} features (${quiz.length} states + ${features.length - quiz.length} not quizzed), ${verts} vertices, ${kb(JSON.stringify(geo).length)}`);
console.log(`  us-states.json      ${shared} state-border segments, ${pairs.size} neighbouring pairs; ${skipped} coast/international segments left to the country layer`);
console.log(`                      all 50 states have a capital and a label point inside themselves`);

/*
 * Assembles public/data/countries.json — the single source of truth for what exists.
 *
 * Entity basis: 193 UN member states + 2 UN observer states (Vatican City, Palestine)
 * = 195 quizzable. Five de facto states are rendered on the map but never quizzed.
 * See docs/entity-decisions.md. The build FAILS on any count or join it cannot verify:
 * silently shipping 194 countries is exactly the kind of error nobody notices.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  UN_MEMBER_FIXES, OBSERVER_STATES, DE_FACTO_STATES, ABSORBED_INTO, RENDERED_ONLY,
  ISO_ALIASES, CAPITALS, NAME_ALIASES, MISCONCEPTION_CAPITALS,
} from './overrides.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cache = (f) => JSON.parse(readFileSync(join(here, '.cache', f), 'utf8'));
const out = (f) => join(here, '..', 'public', 'data', f);

const fail = (msg) => { console.error(`\n  BUILD FAILED: ${msg}\n`); process.exit(1); };

/* Natural Earth's ISO_A3 is -99 for France, Norway, Kosovo, N. Cyprus and Somaliland.
 * ISO_A3_EH fixes the first two; ADM0_A3 covers the rest. A silent -99 bucket is how
 * France quietly loses all eight of its neighbours, so an unresolved code is fatal. */
const neIso = (p) => {
  for (const k of [p.ISO_A3_EH, p.ISO_A3, p.ADM0_A3]) if (k && k !== '-99') return k;
  return null;
};

const wc = cache('world-countries.json');
const ne110 = cache('ne_110m_admin_0_countries.geojson');

const iso = (c) => ISO_ALIASES[c] ?? c;

// --- which Natural Earth polygons exist, and their population -------------------
const nePolys = new Map();
for (const f of ne110.features) {
  const code = neIso(f.properties);
  if (!code) fail(`110m feature "${f.properties.NAME}" has no resolvable ISO code`);
  nePolys.set(code, f.properties);
}

// --- the quizzable set ----------------------------------------------------------
const isMember = (c) => Boolean(UN_MEMBER_FIXES[c.cca3] ?? c.unMember);
const isDeFacto = (c) => Object.hasOwn(DE_FACTO_STATES, iso(c.cca3));

const quizzable = wc.filter((c) =>
  isMember(c) || OBSERVER_STATES.includes(c.cca3) || isDeFacto(c));

/* Counted in three separate buckets on purpose. Adding the de facto states must not be
 * able to hide a change in the UN membership count behind a single total. */
const members = quizzable.filter(isMember).length;
const deFacto = quizzable.filter(isDeFacto).length;
const observers = quizzable.length - members - deFacto;
if (members !== 193) fail(`expected 193 UN member states, got ${members}`);
if (observers !== 2) fail(`expected 2 observer states, got ${observers}`);
if (deFacto !== 2) fail(`expected 2 de facto states, got ${deFacto}`);

// --- population bands, for distractor plausibility -------------------------------
// A player who only ever sees famous distractors solves obscure questions by
// elimination. Bands keep distractors within one step of the target's prominence.
const popOf = (code) => Number(nePolys.get(code)?.POP_EST ?? 0);
const BANDS = [50e6, 10e6, 2e6, 300e3]; // >50M=0, >10M=1, >2M=2, >300k=3, else 4
const bandOf = (pop) => { for (let i = 0; i < BANDS.length; i++) if (pop >= BANDS[i]) return i; return 4; };

// --- assemble --------------------------------------------------------------------
const countries = quizzable.map((c) => {
  const code = iso(c.cca3);
  const cap = CAPITALS[c.cca3];
  const primary = cap?.primary ?? c.capital?.[0];
  if (!primary) fail(`${code} (${c.name.common}) has no capital`);

  const pop = popOf(code);
  const upstreamAlts = c.altSpellings.filter((s) => s.length > 3 && s !== c.name.common);
  return {
    iso: code,
    iso2: c.cca2,
    name: c.name.common,
    official: c.name.official,
    capital: primary,
    capitalAccept: cap?.accept ?? [],
    continent: c.region,
    subregion: c.subregion,
    lat: c.latlng[0],
    lon: c.latlng[1],
    pop,
    salience: bandOf(pop),
    quizzable: true,
    deFacto: isDeFacto(c),
    hasPolygon: nePolys.has(code),
    borders: c.borders.map(iso),
    aliases: [...new Set([...upstreamAlts, ...(NAME_ALIASES[c.cca3] ?? [])])],
    misconception: MISCONCEPTION_CAPITALS[c.cca3] ?? null,
  };
});

// --- rendered-only entities ------------------------------------------------------
for (const [code, meta] of Object.entries(RENDERED_ONLY)) {
  const src = wc.find((c) => iso(c.cca3) === code);
  const ne = nePolys.get(code);
  if (!ne) fail(`rendered-only entity ${code} has no 110m polygon`);
  countries.push({
    iso: code, iso2: src?.cca2 ?? null, name: meta.name,
    official: src?.name.official ?? meta.name,
    capital: null, capitalAccept: [],
    continent: src?.region ?? ne.CONTINENT, subregion: src?.subregion ?? ne.SUBREGION,
    lat: src?.latlng[0] ?? null, lon: src?.latlng[1] ?? null,
    pop: Number(ne.POP_EST ?? 0), salience: bandOf(Number(ne.POP_EST ?? 0)),
    quizzable: false, hasPolygon: true,
    borders: (src?.borders ?? []).map(iso), aliases: [], misconception: null,
    note: meta.note,
  });
}

// --- verification ----------------------------------------------------------------
const q = countries.filter((c) => c.quizzable);
if (q.length !== 197) fail(`expected 197 quizzable, got ${q.length}`);

/* Absorbed territory must not survive as an entity anywhere. */
for (const child of Object.keys(ABSORBED_INTO)) {
  if (countries.some((c) => c.iso === child)) fail(`${child} is absorbed but still an entity`);
}

/* A capital cannot be both accepted as correct and offered as a wrong answer. */
for (const c of q) {
  if (c.capitalAccept.includes(c.capital)) fail(`${c.iso} accepts its own asked capital`);
  if (c.misconception && (c.misconception === c.capital || c.capitalAccept.includes(c.misconception)))
    fail(`${c.iso}: "${c.misconception}" is both accepted as correct and offered as a distractor`);
}

const dupes = q.map((c) => c.iso).filter((v, i, a) => a.indexOf(v) !== i);
if (dupes.length) fail(`duplicate ISO codes: ${dupes.join(', ')}`);

/* Every border reference must resolve to something we recognise. References to
 * non-sovereign territories are dropped rather than kept: "France borders Brazil"
 * (via French Guiana) is true, and pedagogically confusing in a continent-scoped
 * game. A code unknown to world-countries entirely is a real error and fails. */
const known = new Set(countries.map((c) => c.iso));
const allCodes = new Set(wc.map((c) => iso(c.cca3)));
const droppedBorders = new Map();
for (const c of countries) {
  // A border with absorbed territory is a border with whatever absorbed it - and a
  // border with yourself is not a border at all.
  c.borders = [...new Set(c.borders.map((b) => ABSORBED_INTO[b] ?? b))].filter((b) => b !== c.iso);
  c.borders = c.borders.filter((b) => {
    if (known.has(b)) return true;
    if (!allCodes.has(b)) fail(`${c.iso} borders code ${b}, unknown to every source`);
    droppedBorders.set(b, (droppedBorders.get(b) ?? 0) + 1);
    return false;
  });
}

writeFileSync(out('countries.json'), JSON.stringify(countries, null, 0));

console.log(`  countries.json      ${q.length} quizzable (${members} members + ${observers} observers + ${deFacto} de facto)`);
console.log(`                      absorbed: ${Object.entries(ABSORBED_INTO).map(([a, b]) => `${a}->${b}`).join(', ')}`);
console.log(`                      + ${countries.length - q.length} rendered-only: ${Object.keys(RENDERED_ONLY).join(', ')}`);
const dropped = [...droppedBorders.entries()]
  .map(([code, n]) => `${wc.find((c) => iso(c.cca3) === code)?.name.common ?? code} (${n})`);
if (dropped.length) console.log(`  dropped territory borders: ${dropped.join(', ')}`);

/*
 * The only module that knows where the data files live, and the only place the
 * `quizzable` flag is interpreted. Everything downstream asks this module for a set of
 * countries rather than filtering the raw list itself — that is what keeps the entity
 * ruling in one place instead of scattered across four game modes.
 */
import type { Adjacency, Country } from './types';

const base = `${import.meta.env.BASE_URL}data`;

async function json<T>(file: string): Promise<T> {
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) throw new Error(`Could not load ${file}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface AtlasData {
  /** Every entity including the five rendered-only ones. For the map. */
  all: Country[];
  /** The 195. The only list a quiz may draw from. */
  quizzable: Country[];
  byIso: Map<string, Country>;
  adjacency: Adjacency;
}

let cache: Promise<AtlasData> | null = null;

export function loadAtlasData(): Promise<AtlasData> {
  cache ??= (async () => {
    const [all, adjacency] = await Promise.all([
      json<Country[]>('countries.json'),
      json<Adjacency>('adjacency.json'),
    ]);
    return {
      all,
      quizzable: all.filter((c) => c.quizzable),
      byIso: new Map(all.map((c) => [c.iso, c])),
      adjacency,
    };
  })();
  return cache;
}

/** Countries a quiz may ask about, optionally narrowed to continents. */
export function quizPool(data: AtlasData, continents?: readonly string[]): Country[] {
  if (!continents || continents.length === 0) return data.quizzable;
  const want = new Set(continents);
  return data.quizzable.filter((c) => want.has(c.continent));
}

export const flagUrl = (iso: string): string => `${base}/flags/${iso}.svg`;

/** One US state, as built by scripts/build-states.mjs. `iso` is ISO 3166-2, e.g. US-CO. */
export interface UsState {
  iso: string;
  postal: string;
  name: string;
  /** null only for DC, which is drawn but not quizzed. */
  capital: string | null;
  quizzable: boolean;
  labelPoint: [number, number];
  /** Angular radius of the largest landmass - decides whether it needs a marker. */
  radius: number;
}

export interface StatesData {
  all: UsState[];
  quizzable: UsState[];
  byIso: Map<string, UsState>;
  geo: unknown;
  /** Border classes per feature and ring: '1' drawn, '-' left to the country layer. */
  classes: string[][];
}

let statesCache: Promise<StatesData> | null = null;

export function loadStatesData(): Promise<StatesData> {
  statesCache ??= (async () => {
    const [meta, geo] = await Promise.all([
      json<{ states: UsState[]; classes: string[][] }>('us-states.json'),
      json<unknown>('us-states.geojson'),
    ]);
    return {
      all: meta.states,
      quizzable: meta.states.filter((s) => s.quizzable),
      byIso: new Map(meta.states.map((s) => [s.iso, s])),
      geo,
      classes: meta.classes,
    };
  })();
  return statesCache;
}

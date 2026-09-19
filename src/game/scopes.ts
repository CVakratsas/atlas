/*
 * The seven playable scopes.
 *
 * The Americas is split in two because a globe only shows you about a hemisphere, and
 * the continent spans 137 degrees of longitude by 128 of latitude - Alaska and Tierra
 * del Fuego cannot both be visible and clickable at once. The split follows the
 * `subregion` field already in countries.json.
 */
import type { Country } from '../data/types';

export interface Scope {
  name: string;
  /** [west, south, east, north] - what the camera frames. */
  bounds: [number, number, number, number];
  includes: (c: Country) => boolean;
}

export const SCOPES: Scope[] = [
  { name: 'Europe', bounds: [-25, 34, 45, 71], includes: (c) => c.continent === 'Europe' },
  { name: 'Africa', bounds: [-19, -36, 52, 38], includes: (c) => c.continent === 'Africa' },
  { name: 'Asia', bounds: [25, -11, 150, 78], includes: (c) => c.continent === 'Asia' },
  {
    name: 'North America',
    bounds: [-170, 7, -52, 72],
    includes: (c) => c.continent === 'Americas' && c.subregion !== 'South America',
  },
  {
    name: 'South America',
    bounds: [-82, -56, -34, 13],
    includes: (c) => c.continent === 'Americas' && c.subregion === 'South America',
  },
  { name: 'Oceania', bounds: [110, -48, 180, 0], includes: (c) => c.continent === 'Oceania' },
  { name: 'World', bounds: [-180, -58, 180, 84], includes: () => true },
];

export const scopeByName = (name: string): Scope =>
  SCOPES.find((s) => s.name === name) ?? SCOPES[0]!;

export const countriesInScope = (all: Country[], scope: Scope): Country[] =>
  all.filter((c) => c.quizzable && scope.includes(c));

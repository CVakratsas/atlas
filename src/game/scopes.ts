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
  /* East of the antimeridian on purpose: Kiribati sits at 157W and Samoa at 172W, so a
   * box stopping at 180 leaves both outside the frame. A desktop window is wide enough to
   * catch them anyway; a portrait one is not, and they are two of the fourteen. Only the
   * camera reads these bounds - membership comes from `includes` - so carrying on past
   * 180 costs nothing. */
  { name: 'Oceania', bounds: [110, -48, 205, 0], includes: (c) => c.continent === 'Oceania' },
  { name: 'World', bounds: [-180, -58, 180, 84], includes: () => true },
];

/*
 * The US game's one and only region. Kept out of SCOPES because it is not a choice on
 * the world picker - its places are states, not countries, so `includes` never matches.
 *
 * Alaska and Hawaii are framed in with the lower 48, by the same fit-everything rule as
 * every other round: a state the game asks for must be on the screen. The western edge
 * stops short of the far Aleutians, which are Alaska's anyway.
 */
export const US_SCOPE: Scope = {
  name: 'United States',
  bounds: [-168, 18, -66, 72],
  includes: () => false,
};

export const scopeByName = (name: string): Scope =>
  name === US_SCOPE.name ? US_SCOPE : SCOPES.find((s) => s.name === name) ?? SCOPES[0]!;

export const countriesInScope = (all: Country[], scope: Scope): Country[] =>
  all.filter((c) => c.quizzable && scope.includes(c));

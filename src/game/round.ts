/*
 * Building a round: which countries, in what order.
 *
 * Order is a seeded shuffle, biased so countries the player has missed before come up
 * earlier. That bias is the only thing left of the original brief's learning engine, and
 * it is worth the ten lines: it is what stops the game being a pure reflex test and
 * makes it spend your time where you are weak.
 */
import type { Country } from '../data/types';
import { seeded } from './rng';
import { countriesInScope, scopeByName } from './scopes';

export type Mode = 'countries' | 'capitals' | 'flags' | 'states' | 'stateCapitals';

export interface ModeInfo { id: Mode; title: string; blurb: string }

/** The world game: one of these, then a region. */
export const MODES: ModeInfo[] = [
  { id: 'countries', title: 'Countries', blurb: 'Find the country by name' },
  { id: 'capitals', title: 'Capitals', blurb: 'Find the country from its capital' },
  { id: 'flags', title: 'Flags', blurb: 'Find the country from its flag' },
];

/** The US game: one of these, and the region is always the United States. */
export const US_MODES: ModeInfo[] = [
  { id: 'states', title: 'States', blurb: 'Find the state by name' },
  { id: 'stateCapitals', title: 'Capitals', blurb: 'Find the state from its capital' },
];

export const isStateMode = (m: Mode): boolean => m === 'states' || m === 'stateCapitals';
const asksCapital = (m: Mode): boolean => m === 'capitals' || m === 'stateCapitals';

/** Anything a round can ask about: a country or a US state. */
export interface Place { iso: string; name: string; capital: string | null }

export interface Prompt {
  iso: string;
  /** What the card shows. For flags this is still the country name, used by screen readers. */
  label: string;
  /** Secondary line: the country a capital belongs to is never shown, but the continent is. */
  sub: string;
  mode: Mode;
}

export interface RoundInput {
  mode: Mode;
  scope: string;
  /** Every country; the round draws from those in `scope`. Ignored when `pool` is set. */
  all?: Country[];
  /** The places to ask about, when they are not countries - the US states. */
  pool?: Place[];
  seed: string;
  missCounts?: Record<string, number>;
}

export function buildRound(input: RoundInput): Prompt[] {
  const pool: Place[] = input.pool ?? countriesInScope(input.all ?? [], scopeByName(input.scope));
  const rng = seeded(input.seed, input.mode, input.scope);
  const misses = input.missCounts ?? {};

  /* Sort by a random key nudged down by past misses, so a country you keep getting
   * wrong drifts toward the front without the order becoming predictable. */
  const ordered = pool
    .map((c) => {
      const miss = Math.min(6, misses[c.iso] ?? 0);
      return { c, key: rng() - miss * 0.12 };
    })
    .sort((a, b) => a.key - b.key)
    .map((x) => x.c);

  return ordered.map((c) => ({
    iso: c.iso,
    label: asksCapital(input.mode) ? c.capital! : c.name,
    sub: asksCapital(input.mode) ? 'capital of…' : '',
    mode: input.mode,
  }));
}

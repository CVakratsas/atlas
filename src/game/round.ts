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

export type Mode = 'countries' | 'capitals' | 'flags';

export const MODES: { id: Mode; title: string; blurb: string }[] = [
  { id: 'countries', title: 'Countries', blurb: 'Find the country by name' },
  { id: 'capitals', title: 'Capitals', blurb: 'Find the country from its capital' },
  { id: 'flags', title: 'Flags', blurb: 'Find the country from its flag' },
];

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
  all: Country[];
  seed: string;
  missCounts?: Record<string, number>;
}

export function buildRound(input: RoundInput): Prompt[] {
  const scope = scopeByName(input.scope);
  const pool = countriesInScope(input.all, scope);
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
    label: input.mode === 'capitals' ? c.capital! : c.name,
    sub: input.mode === 'capitals' ? 'capital of…' : c.continent,
    mode: input.mode,
  }));
}

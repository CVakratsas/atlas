/*
 * Scoring and round state. A pure reducer - no timers, no DOM, no three.js.
 *
 * The rule that matters most: a wrong click does NOT advance the prompt. Advancing on
 * failure is how these games let you finish a continent without ever learning the hard
 * countries, which is precisely the thing the original brief was written against.
 */

export const POINTS = {
  correct: 100,
  /** Awarded on a sliding scale over the first `speedWindowMs`. */
  speedBonus: 50,
  speedWindowMs: 5000,
  wrong: -50,
  /** Streak multiplier is 1 + streak/10, capped here. */
  maxMultiplier: 3,
} as const;

export interface RoundState {
  order: string[];
  index: number;
  found: string[];
  missed: string[];
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  wrongCount: number;
  /** ms since the round began, at the moment the current prompt appeared. */
  promptShownAt: number;
  done: boolean;
}

export function startRound(order: string[], now = 0): RoundState {
  return {
    order,
    index: 0,
    found: [],
    missed: [],
    score: 0,
    streak: 0,
    bestStreak: 0,
    correctCount: 0,
    wrongCount: 0,
    promptShownAt: now,
    done: order.length === 0,
  };
}

export const currentTarget = (s: RoundState): string | null =>
  s.done ? null : (s.order[s.index] ?? null);

export type ClickResult =
  | { kind: 'correct'; iso: string; gained: number }
  | { kind: 'wrong'; iso: string; lost: number }
  | { kind: 'ignored'; reason: 'ocean' | 'already-found' | 'not-playable' | 'round-over' }
  /** A real place, but not one this round is about - Spain in an Africa round. */
  | { kind: 'ignored'; reason: 'out-of-round'; iso: string };

export interface ClickOutcome { state: RoundState; result: ClickResult }

export function multiplierFor(streak: number): number {
  return Math.min(POINTS.maxMultiplier, 1 + streak * 0.1);
}

export function speedBonusFor(elapsedMs: number): number {
  const t = Math.max(0, Math.min(1, 1 - elapsedMs / POINTS.speedWindowMs));
  return Math.round(POINTS.speedBonus * t);
}

/**
 * Apply a click.
 *
 * `iso` is null for the ocean or the far side of the globe. A misclick is not a mistake
 * and is never punished - only a click on a real, playable, not-yet-found place that
 * is not the target counts as wrong.
 *
 * `inRound`, when given, narrows that further to the places this round is about. A tap
 * on Spain during an Africa round is almost always a finger landing just past the edge
 * of the lit region - on a phone, routinely - and costing 50 points for it teaches
 * nothing. It is ignored, and the caller says so.
 */
export function click(
  state: RoundState,
  iso: string | null,
  now: number,
  isPlayable: (iso: string) => boolean,
  inRound?: (iso: string) => boolean,
): ClickOutcome {
  if (state.done) return { state, result: { kind: 'ignored', reason: 'round-over' } };
  if (iso === null) return { state, result: { kind: 'ignored', reason: 'ocean' } };
  if (state.found.includes(iso)) {
    return { state, result: { kind: 'ignored', reason: 'already-found' } };
  }
  // Kosovo, Taiwan and the rest are on the map but are never targets and never penalties.
  if (!isPlayable(iso)) {
    return { state, result: { kind: 'ignored', reason: 'not-playable' } };
  }
  if (inRound && !inRound(iso)) {
    return { state, result: { kind: 'ignored', reason: 'out-of-round', iso } };
  }

  const target = currentTarget(state);
  if (iso !== target) {
    const next: RoundState = {
      ...state,
      score: Math.max(0, state.score + POINTS.wrong),
      streak: 0,
      wrongCount: state.wrongCount + 1,
      missed: state.missed.includes(target!) ? state.missed : [...state.missed, target!],
    };
    return { state: next, result: { kind: 'wrong', iso, lost: -POINTS.wrong } };
  }

  const gained = Math.round(
    (POINTS.correct + speedBonusFor(now - state.promptShownAt)) * multiplierFor(state.streak),
  );
  const streak = state.streak + 1;
  const index = state.index + 1;
  const next: RoundState = {
    ...state,
    index,
    found: [...state.found, iso],
    score: state.score + gained,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    correctCount: state.correctCount + 1,
    promptShownAt: now,
    done: index >= state.order.length,
  };
  return { state: next, result: { kind: 'correct', iso, gained } };
}

/** Give up on the current prompt: it counts as missed, and the streak goes. */
export function skip(state: RoundState, now: number): RoundState {
  const target = currentTarget(state);
  if (!target) return state;
  const index = state.index + 1;
  return {
    ...state,
    index,
    streak: 0,
    missed: state.missed.includes(target) ? state.missed : [...state.missed, target],
    promptShownAt: now,
    done: index >= state.order.length,
  };
}

export const accuracy = (s: RoundState): number => {
  const total = s.correctCount + s.wrongCount;
  return total === 0 ? 1 : s.correctCount / total;
};

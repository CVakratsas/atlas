/*
 * Best times and miss counts. localStorage, wrapped - every read and write can throw in
 * private browsing, and the game must play perfectly when it does. Losing a high score
 * is a shrug; a crash on boot is not.
 */
const KEY = 'atlas.v1';

export interface Record_ { timeMs: number; score: number; at: number }
export interface Saved {
  best: Record<string, Record_>;          // `${mode}:${scope}`
  misses: Record<string, number>;         // iso -> times missed
}

const empty = (): Saved => ({ best: {}, misses: {} });

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return { best: parsed.best ?? {}, misses: parsed.misses ?? {} };
  } catch {
    return empty();
  }
}

export function save(data: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private browsing, quota, or storage disabled - the round still stands */
  }
}

export const bestKey = (mode: string, scope: string): string => `${mode}:${scope}`;

/** Merge a finished round in, keeping the better time. */
export function record(
  prev: Saved, mode: string, scope: string, timeMs: number, score: number, missed: string[],
): Saved {
  const key = bestKey(mode, scope);
  const old = prev.best[key];
  const best = (!old || timeMs < old.timeMs) ? { timeMs, score, at: Date.now() } : old;
  const misses = { ...prev.misses };
  for (const iso of missed) misses[iso] = (misses[iso] ?? 0) + 1;
  return { best: { ...prev.best, [key]: best }, misses };
}

export const formatTime = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

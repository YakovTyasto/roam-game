import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { buildDifficultyPool } from './difficultyPool';
import { selectUniqueLocationsAvoidingHistory } from './selectRounds';

/**
 * Pick the next single location for an Endless round. Unlike a fixed game
 * (which pre-selects `count` unique locations up front), Endless generates
 * one round at a time — this keeps a session duplicate-free for as long as
 * the difficulty-appropriate pool allows, then (once genuinely exhausted)
 * falls back to repeats rather than stalling the game. `excludeIds` should
 * be every location already served *this session*; `recentIds` is the
 * cross-match cooldown history (see utils/locationHistory.ts).
 */
export function pickNextEndlessLocation(
  all: readonly GameLocation[],
  difficulty: Difficulty,
  excludeIds: ReadonlySet<string>,
  recentIds: readonly string[] = [],
  rng: () => number = Math.random,
): GameLocation | null {
  const { locations: pool } = buildDifficultyPool(all, difficulty, 1);
  if (pool.length === 0) return null;

  const fresh = pool.filter((l) => !excludeIds.has(l.id));
  const candidates = fresh.length > 0 ? fresh : pool;

  const ordered = selectUniqueLocationsAvoidingHistory(candidates, candidates.length, recentIds, rng);
  return ordered[0] ?? candidates[0] ?? null;
}

/** How often to show the "this uses more Street View quota" notice. */
export const ENDLESS_USAGE_WARNING_INTERVAL = 25;

/** True on round 25, 50, 75, ... (1-based round number just completed). */
export function shouldWarnEndlessUsage(roundNumberCompleted: number): boolean {
  return roundNumberCompleted > 0 && roundNumberCompleted % ENDLESS_USAGE_WARNING_INTERVAL === 0;
}

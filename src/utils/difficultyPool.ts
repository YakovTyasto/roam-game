import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';

/**
 * Difficulty-aware location pooling — the shared selection mechanism used by
 * BOTH solo and multiplayer so their location behaviour cannot drift.
 *
 * The primary pool for a difficulty is simply the locations tagged with it. If
 * that pool cannot supply `needed` unique locations for a game, we deliberately
 * widen it using a fixed adjacency order (rather than silently reusing the same
 * global pool for every difficulty). The caller is told when a fallback was
 * used so it can be surfaced/logged.
 */

/** Adjacency order used when a difficulty's own pool is too small. */
const FALLBACK_ORDER: Record<Difficulty, readonly Difficulty[]> = {
  easy: ['easy', 'normal', 'hard'],
  // Normal borrows from the easy side first (closest in spirit), then hard.
  normal: ['normal', 'easy', 'hard'],
  hard: ['hard', 'normal', 'easy'],
};

/** All locations tagged with exactly `difficulty`. Order preserved. */
export function locationsForDifficulty(
  all: readonly GameLocation[],
  difficulty: Difficulty,
): GameLocation[] {
  return all.filter((l) => l.difficulty === difficulty);
}

export interface DifficultyPool {
  /** The usable pool for this difficulty (>= its own pool). */
  locations: GameLocation[];
  /** True if adjacent-difficulty locations were mixed in to reach `needed`. */
  usedFallback: boolean;
  /** Whether the final pool still cannot supply `needed` locations. */
  sufficient: boolean;
}

/**
 * Build a pool for `difficulty` guaranteed to be at least `needed` locations
 * where the dataset allows. Starts with the difficulty's own locations and,
 * only if short, appends adjacent-difficulty locations in a fixed order.
 *
 * Never mutates the input. Duplicates (by id) are removed while preserving the
 * primary-difficulty-first ordering.
 */
export function buildDifficultyPool(
  all: readonly GameLocation[],
  difficulty: Difficulty,
  needed: number,
): DifficultyPool {
  const primary = locationsForDifficulty(all, difficulty);
  if (primary.length >= needed) {
    return { locations: primary, usedFallback: false, sufficient: true };
  }

  // Widen using the adjacency order, skipping the primary tier (already added).
  const seen = new Set(primary.map((l) => l.id));
  const widened = [...primary];
  for (const tier of FALLBACK_ORDER[difficulty]) {
    if (tier === difficulty) continue;
    for (const loc of all) {
      if (loc.difficulty === tier && !seen.has(loc.id)) {
        seen.add(loc.id);
        widened.push(loc);
      }
    }
    if (widened.length >= needed) break;
  }

  return {
    locations: widened,
    usedFallback: widened.length > primary.length,
    sufficient: widened.length >= needed,
  };
}

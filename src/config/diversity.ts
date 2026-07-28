/**
 * Diversity Engine tunables — one place to reason about "how much variety is
 * enough", shared by the selector, the dataset audit, and the collection
 * availability rules.
 *
 * The numbers below encode a single product goal, stated once so it can be
 * argued with rather than rediscovered from code:
 *
 *   > An ordinary player should be able to play `TARGET_FRESH_GAMES`
 *   > consecutive standard games without meeting a place they have already
 *   > seen in that stretch.
 *
 * Everything else follows arithmetically. A difficulty or collection pool is
 * *comfortable* when it holds at least `roundCount × TARGET_FRESH_GAMES`
 * canonical groups, and merely *playable* when it holds at least
 * `roundCount × MIN_POOL_MULTIPLIER`. Below that it is not shown to players
 * as a working option (see `config/collections.ts` and the audit).
 */

/** Round counts the product actually offers for fixed-length games. */
export const GAME_ROUND_COUNTS: readonly number[] = [3, 5, 10, 20] as const;

/** The canonical "standard game" used for headline audit statements. */
export const STANDARD_ROUND_COUNT = 5;

/**
 * How many consecutive standard games should be repeat-free. Ten games is
 * roughly a week of casual play, and it is the bar the audit reports against.
 */
export const TARGET_FRESH_GAMES = 10;

/**
 * Absolute floor before a pool is considered playable at all. Two full games'
 * worth of distinct places means a second game can differ completely from the
 * first; anything less is a slideshow.
 */
export const MIN_POOL_MULTIPLIER = 2;

/** Groups needed for `roundCount` games to feel comfortably varied. */
export function comfortablePoolSize(roundCount: number): number {
  return roundCount * TARGET_FRESH_GAMES;
}

/** Minimum groups before a pool may be offered to players at all. */
export function minimumPoolSize(roundCount: number): number {
  return roundCount * MIN_POOL_MULTIPLIER;
}

/**
 * Maximum canonical groups retained per player in the persistent history. Also
 * the server-side cap — bounded storage is a hard requirement, and 250 groups
 * covers 50 standard games, comfortably more than the freshness target.
 */
export const HISTORY_LIMIT_GROUPS = 250;

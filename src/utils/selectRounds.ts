import type { GameLocation } from '../types';

/**
 * Pick `count` unique locations at random using a Fisher–Yates partial shuffle.
 * Does not mutate the input array. If `count` exceeds the pool size, every
 * available location is returned (shuffled).
 *
 * An optional `rng` (returning [0, 1)) makes selection deterministic in tests.
 */
export function selectUniqueLocations(
  pool: readonly GameLocation[],
  count: number,
  rng: () => number = Math.random,
): GameLocation[] {
  const items = [...pool];
  const n = Math.min(Math.max(0, Math.floor(count)), items.length);

  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (items.length - i));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items.slice(0, n);
}

/**
 * Pick `count` unique locations from `pool`, preferring ones that are not in
 * `recentIds` (a persistent, newest-first cooldown list — see
 * `utils/locationHistory.ts`). Locations never seen recently are shuffled and
 * placed first; if that isn't enough to reach `count`, the shortfall is filled
 * with the least-recently-played eligible locations (oldest entries in
 * `recentIds` first) rather than failing to reach `count`.
 *
 * Never mutates the input pool. Duplicate-within-selection is impossible: a
 * pool location is either "fresh" or "stale", never both.
 */
export function selectUniqueLocationsAvoidingHistory(
  pool: readonly GameLocation[],
  count: number,
  recentIds: readonly string[] = [],
  rng: () => number = Math.random,
): GameLocation[] {
  const n = Math.min(Math.max(0, Math.floor(count)), pool.length);
  if (n === 0) return [];

  const recentRank = new Map<string, number>();
  recentIds.forEach((id, idx) => {
    if (!recentRank.has(id)) recentRank.set(id, idx);
  });

  const fresh: GameLocation[] = [];
  const stale: GameLocation[] = [];
  for (const loc of pool) {
    (recentRank.has(loc.id) ? stale : fresh).push(loc);
  }

  const shuffledFresh = selectUniqueLocations(fresh, fresh.length, rng);
  if (shuffledFresh.length >= n) {
    return shuffledFresh.slice(0, n);
  }

  // Not enough never-played locations — fill the remainder with the
  // least-recently-played eligible ones (largest index = oldest entry).
  stale.sort((a, b) => recentRank.get(b.id)! - recentRank.get(a.id)!);
  return [...shuffledFresh, ...stale.slice(0, n - shuffledFresh.length)];
}

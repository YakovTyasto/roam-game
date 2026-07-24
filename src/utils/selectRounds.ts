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

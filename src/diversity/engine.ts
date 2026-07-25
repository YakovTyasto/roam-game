/**
 * The Diversity Engine — one pure function that every mode selects rounds
 * through, so solo, Endless and multiplayer cannot drift apart.
 *
 * Pipeline, in strict order:
 *
 *   1. **Collection filter** — a themed collection is a hard constraint. A
 *      request for "Islands" never silently serves a non-island.
 *   2. **Difficulty pool** — the tier's own locations, widened to adjacent
 *      tiers *only* when the tier alone cannot fill the game (unchanged V3
 *      behaviour, now applied inside the collection).
 *   3. **Canonical grouping** — collapse rows that are the same place, so
 *      uniqueness and the bag operate on places, not ids.
 *   4. **Shuffle bag** — deal every eligible group once before repeating any,
 *      reshuffling each cycle.
 *   5. **Novelty tie-break** — inside the cycle, prefer groups the player has
 *      not seen recently (this is what makes a fresh install on a second
 *      device still respect server-side history).
 *   6. **Soft arrangement** — optional in-match geographic spread, applied last
 *      because it may never violate any of the guarantees above.
 *
 * The function is pure: no storage, no clock, no network. Persistence lives in
 * `store.ts`, which commits the returned bag state only once a round has
 * genuinely started.
 */

import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import type { CollectionId } from '../config/collections';
import { DEFAULT_COLLECTION, locationsInCollection } from '../config/collections';
import { buildDifficultyPool } from '../utils/difficultyPool';
import { getGroupIndex, groupIdFor } from '../utils/canonicalGroup';
import type { BagState } from './shuffleBag';
import { EMPTY_BAG, drawFromBag } from './shuffleBag';
import { spreadGeography } from './geoSpread';

export interface SelectionRequest {
  /** The full catalog. */
  all: readonly GameLocation[];
  /** Rounds needed. Clamped to the pool size — a short game beats no game. */
  count: number;
  difficulty?: Difficulty;
  collection?: CollectionId;
  /** Current bag for this (difficulty, collection). Defaults to a fresh bag. */
  bag?: BagState;
  /** Recently played canonical group ids, newest-first. */
  recentGroupIds?: readonly string[];
  /** Injectable RNG in [0, 1). */
  rng?: () => number;
  /** Ordered spares for panorama-resolution failures. */
  backupCount?: number;
  /**
   * Canonical group ids that must not be selected at all (as opposed to merely
   * disfavoured) — e.g. groups already used earlier in an Endless session.
   */
  excludeGroupIds?: readonly string[];
  /**
   * Apply the soft in-match geographic spread rules (default `true`). Turning
   * it off is for tests and for callers that genuinely want the raw novelty
   * order; it never changes which places are *eligible*, only their order.
   */
  spread?: boolean;
  /** Custom soft re-ordering hook, replacing the default spread. */
  arrange?: (ranked: GameLocation[], count: number) => GameLocation[];
}

export interface SelectionResult {
  /** Chosen locations in play order. Never two from one canonical group. */
  locations: GameLocation[];
  /** Ordered spares, same freshness ranking as the picks. */
  backups: GameLocation[];
  /** Canonical group ids of `locations`, in the same order. */
  groupIds: string[];
  /** True when adjacent-difficulty locations had to be mixed in. */
  usedDifficultyFallback: boolean;
  /** Distinct canonical groups the request could draw from. */
  poolGroups: number;
  /** False when the pool could not supply `count` rounds. */
  sufficient: boolean;
  /** Bag state to persist once the round(s) start. */
  nextBag: BagState;
  /** True when this draw wrapped into a new cycle. */
  startedNewCycle: boolean;
}

/**
 * Select rounds. Always terminates and always returns as many rounds as the
 * pool allows; `sufficient` tells the caller whether that was the full count.
 */
export function selectRounds(request: SelectionRequest): SelectionResult {
  const {
    all,
    difficulty = DEFAULT_DIFFICULTY,
    collection = DEFAULT_COLLECTION,
    bag = EMPTY_BAG,
    recentGroupIds = [],
    rng = Math.random,
    backupCount = 0,
    excludeGroupIds = [],
    spread = true,
    arrange,
  } = request;

  const groupIndex = getGroupIndex(all);
  const keyOf = (location: GameLocation): string => groupIdFor(groupIndex, location.id);

  // 1. Collection is a hard filter.
  const inCollection = locationsInCollection(all, collection);

  // 2. Difficulty pool, widened only if this collection's tier is too small.
  const pool = buildDifficultyPool(inCollection, difficulty, request.count);

  // Hard exclusions (e.g. an Endless session's own history).
  const excluded = new Set(excludeGroupIds);
  const eligible = excluded.size
    ? pool.locations.filter((l) => !excluded.has(keyOf(l)))
    : pool.locations;

  // 3–6. Canonical grouping, bag cycling, novelty ranking, soft arrangement.
  const draw = drawFromBag({
    items: eligible,
    count: request.count,
    keyOf,
    state: bag,
    recentKeys: recentGroupIds,
    rng,
    backupCount,
    arrange: arrange ?? (spread ? (ranked, n) => spreadGeography(ranked, n) : undefined),
  });

  const poolGroups = new Set(eligible.map(keyOf)).size;

  return {
    locations: draw.picked,
    backups: draw.backups,
    groupIds: draw.picked.map(keyOf),
    usedDifficultyFallback: pool.usedFallback,
    poolGroups,
    sufficient: draw.picked.length >= Math.max(0, Math.floor(request.count)),
    nextBag: draw.nextState,
    startedNewCycle: draw.startedNewCycle,
  };
}

/**
 * The set of canonical group ids a given request can draw from — the bag's
 * "pool" for cycle bookkeeping. Recomputed at commit time so that recording a
 * round uses exactly the same pool the draw used.
 */
export function poolGroupKeys(
  all: readonly GameLocation[],
  count: number,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
  collection: CollectionId = DEFAULT_COLLECTION,
): Set<string> {
  const index = getGroupIndex(all);
  const pool = buildDifficultyPool(locationsInCollection(all, collection), difficulty, count);
  return new Set(pool.locations.map((l) => groupIdFor(index, l.id)));
}

/** Canonical group ids for a list of locations, in order. */
export function groupIdsFor(
  all: readonly GameLocation[],
  locations: readonly GameLocation[],
): string[] {
  const index = getGroupIndex(all);
  return locations.map((l) => groupIdFor(index, l.id));
}

/** Canonical group ids for a list of *location ids* (e.g. from a manifest). */
export function groupIdsForLocationIds(
  all: readonly GameLocation[],
  locationIds: readonly string[],
): string[] {
  const index = getGroupIndex(all);
  return locationIds.map((id) => groupIdFor(index, id));
}

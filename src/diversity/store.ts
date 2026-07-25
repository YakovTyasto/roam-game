/**
 * Persistence glue for the Diversity Engine.
 *
 * Separated from `engine.ts` on purpose: selection stays a pure function, and
 * everything that touches storage — and, from the server-history layer, the
 * network — lives here behind a synchronous, never-throwing API.
 *
 * The commit rule matters as much as the selection rule: **a place is recorded
 * only once its round has actually started.** Selecting five rounds and
 * recording all five up front (V3 behaviour) burned freshness on games the
 * player abandoned at round two, and on rounds whose panorama never resolved.
 * `commitRoundStarted` is therefore called per round, from the point where the
 * panorama is known to be live.
 */

import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import type { CollectionId } from '../config/collections';
import { DEFAULT_COLLECTION } from '../config/collections';
import { getGroupIndex, groupIdFor } from '../utils/canonicalGroup';
import {
  readLocationHistory,
  recordPlayedLocations,
  resetLocationHistory,
} from '../utils/locationHistory';
import type { BagState } from './shuffleBag';
import { markDrawn } from './shuffleBag';
import { bagKey, readBag, resetBags, writeBag } from './bagStorage';
import { poolGroupKeys } from './engine';

export interface DiversityState {
  /** Bag for the requested (difficulty, collection). */
  bag: BagState;
  /** Recently played canonical group ids, newest-first. */
  recentGroupIds: string[];
}

/**
 * Everything selection needs, read synchronously from local storage. Safe to
 * call during render or before any network is available — it never awaits and
 * never throws, which is what keeps it off the first-paint critical path.
 */
export function readDiversityState(
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
  collection: CollectionId = DEFAULT_COLLECTION,
): DiversityState {
  return {
    bag: readBag(bagKey(difficulty, collection)),
    recentGroupIds: readLocationHistory(),
  };
}

export interface CommitParams {
  all: readonly GameLocation[];
  /** Canonical group id of the round that just started. */
  groupId: string;
  /** The game's round count — the pool widens by it, so the bag must match. */
  count: number;
  difficulty?: Difficulty;
  collection?: CollectionId;
}

/**
 * Record that a round has started: advance the shuffle bag and push the group
 * to the front of the local history. Idempotent in effect — replaying the same
 * group simply wraps the bag into a new cycle, which is the correct meaning of
 * "this place came round again".
 */
export function commitRoundStarted({
  all,
  groupId,
  count,
  difficulty = DEFAULT_DIFFICULTY,
  collection = DEFAULT_COLLECTION,
}: CommitParams): void {
  if (!groupId) return;
  const key = bagKey(difficulty, collection);
  const pool = poolGroupKeys(all, count, difficulty, collection);
  writeBag(key, markDrawn(readBag(key), [groupId], pool));
  recordPlayedLocations([groupId]);
}

/** Canonical group id for a location id, using the memoised catalog index. */
export function groupIdOf(all: readonly GameLocation[], locationId: string): string {
  return groupIdFor(getGroupIndex(all), locationId);
}

/**
 * Clear every bag and the local history — the "Reset recently played
 * locations" action. Server-side history is cleared separately and explicitly;
 * a local reset must not silently delete durable data.
 */
export function resetDiversityState(): void {
  resetBags();
  resetLocationHistory();
}

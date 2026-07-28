import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import type { CollectionId } from '../config/collections';
import { DEFAULT_COLLECTION } from '../config/collections';
import { LOCATIONS } from '../data/locations';
import { selectRounds } from '../diversity/engine';
import { readDiversityState } from '../diversity/store';

/**
 * Abstraction over "where locations come from". The game logic depends only on
 * this interface, so the bundled client-side dataset can later be swapped for a
 * backend/API implementation without touching the game or UI code.
 */

export interface GameLocationsOptions {
  collection?: CollectionId;
  /** Extra ordered spares beyond `count`, for panorama-resolution failures. */
  backupCount?: number;
  /** Injectable RNG for deterministic tests. */
  rng?: () => number;
}

export interface GameLocationsResult {
  locations: GameLocation[];
  backups: GameLocation[];
  /** True when adjacent-difficulty locations had to be mixed in. */
  usedFallback: boolean;
  /** Canonical group ids of `locations`, in the same order. */
  groupIds: string[];
  /** False when the pool could not supply the requested count. */
  sufficient: boolean;
}

export interface LocationProvider {
  /** All available locations (used for pooling / backups). */
  getAll(): Promise<GameLocation[]>;
  /**
   * Return `count` unique locations for the given difficulty/collection plus a
   * set of spare "backup" locations that can transparently replace any that
   * lack a usable panorama.
   *
   * Selection goes through the Diversity Engine, so results are bag-cycled
   * (every eligible place is served before any repeats) and history-aware.
   * It deliberately records **nothing**: a place is recorded only once its
   * round has actually started — see `diversity/store.ts#commitRoundStarted`.
   * Recording at selection time (the V3 behaviour) burned freshness on games
   * the player abandoned and on rounds whose panorama never resolved.
   */
  getGameLocations(
    count: number,
    difficulty?: Difficulty,
    options?: GameLocationsOptions,
  ): Promise<GameLocationsResult>;
}

/** Default provider backed by the bundled, in-memory dataset. */
export class StaticLocationProvider implements LocationProvider {
  constructor(private readonly pool: GameLocation[] = LOCATIONS) {}

  async getAll(): Promise<GameLocation[]> {
    return [...this.pool];
  }

  async getGameLocations(
    count: number,
    difficulty: Difficulty = DEFAULT_DIFFICULTY,
    options: GameLocationsOptions = {},
  ): Promise<GameLocationsResult> {
    const collection = options.collection ?? DEFAULT_COLLECTION;
    const { bag, recentGroupIds } = readDiversityState(difficulty, collection);

    const result = selectRounds({
      all: this.pool,
      count,
      difficulty,
      collection,
      bag,
      recentGroupIds,
      rng: options.rng,
      // Everything the pool can still offer becomes an ordered backup, matching
      // the previous behaviour where the remainder of the shuffled pool stayed
      // available for graceful panorama skips.
      backupCount: options.backupCount ?? this.pool.length,
    });

    return {
      locations: result.locations,
      backups: result.backups,
      usedFallback: result.usedDifficultyFallback,
      groupIds: result.groupIds,
      sufficient: result.sufficient,
    };
  }
}

export const locationProvider: LocationProvider = new StaticLocationProvider();

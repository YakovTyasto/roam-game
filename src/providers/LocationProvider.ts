import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import { LOCATIONS } from '../data/locations';
import { selectUniqueLocationsAvoidingHistory } from '../utils/selectRounds';
import { buildDifficultyPool } from '../utils/difficultyPool';
import { readLocationHistory, recordPlayedLocations } from '../utils/locationHistory';

/**
 * Abstraction over "where locations come from". The game logic depends only on
 * this interface, so the bundled client-side dataset can later be swapped for a
 * backend/API implementation without touching the game or UI code.
 */
export interface LocationProvider {
  /** All available locations (used for pooling / backups). */
  getAll(): Promise<GameLocation[]>;
  /**
   * Return `count` unique locations for the given difficulty plus a set of
   * spare "backup" locations (also difficulty-appropriate) that can
   * transparently replace any that lack a usable panorama.
   */
  getGameLocations(
    count: number,
    difficulty?: Difficulty,
  ): Promise<{ locations: GameLocation[]; backups: GameLocation[]; usedFallback: boolean }>;
}

/** Default provider backed by the bundled, in-memory dataset. */
export class StaticLocationProvider implements LocationProvider {
  constructor(private readonly pool: GameLocation[] = LOCATIONS) {}

  async getAll(): Promise<GameLocation[]> {
    return [...this.pool];
  }

  async getGameLocations(count: number, difficulty: Difficulty = DEFAULT_DIFFICULTY) {
    // Build the difficulty-appropriate pool (with adjacent-tier fallback if the
    // primary tier is too small), then shuffle: the first `count` are the
    // rounds and the remainder act as ordered backups for graceful skips.
    const { locations: pool, usedFallback } = buildDifficultyPool(
      this.pool,
      difficulty,
      count,
    );
    const recentIds = readLocationHistory();
    const shuffled = selectUniqueLocationsAvoidingHistory(pool, pool.length, recentIds);
    const locations = shuffled.slice(0, count);
    const backups = shuffled.slice(count);
    recordPlayedLocations(locations.map((l) => l.id));
    return { locations, backups, usedFallback };
  }
}

export const locationProvider: LocationProvider = new StaticLocationProvider();

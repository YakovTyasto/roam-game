import type { GameLocation } from '../types';
import { LOCATIONS } from '../data/locations';
import { selectUniqueLocations } from '../utils/selectRounds';

/**
 * Abstraction over "where locations come from". The game logic depends only on
 * this interface, so the bundled client-side dataset can later be swapped for a
 * backend/API implementation without touching the game or UI code.
 */
export interface LocationProvider {
  /** All available locations (used for pooling / backups). */
  getAll(): Promise<GameLocation[]>;
  /**
   * Return `count` unique locations plus a set of spare "backup" locations that
   * can transparently replace any that lack a usable panorama.
   */
  getGameLocations(
    count: number,
  ): Promise<{ locations: GameLocation[]; backups: GameLocation[] }>;
}

/** Default provider backed by the bundled, in-memory dataset. */
export class StaticLocationProvider implements LocationProvider {
  constructor(private readonly pool: GameLocation[] = LOCATIONS) {}

  async getAll(): Promise<GameLocation[]> {
    return [...this.pool];
  }

  async getGameLocations(count: number) {
    // Shuffle the whole pool once; the first `count` are the rounds and the
    // remainder act as ordered backups for graceful panorama-not-found skips.
    const shuffled = selectUniqueLocations(this.pool, this.pool.length);
    return {
      locations: shuffled.slice(0, count),
      backups: shuffled.slice(count),
    };
  }
}

export const locationProvider: LocationProvider = new StaticLocationProvider();

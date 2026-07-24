/** A geographic coordinate. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** A curated Street View location. */
export interface GameLocation {
  /** Stable unique id. */
  id: string;
  lat: number;
  lng: number;
  /** Human-friendly label, revealed ONLY after the player guesses. */
  label: string;
  country: string;
  /**
   * Difficulty tier this location belongs to. Drives difficulty-aware round
   * selection (see utils/difficultyPool.ts). Iconic, high-clue spots are
   * `easy`; balanced ones `normal`; remote/ambiguous ones `hard`.
   */
  difficulty: import('../config/difficulty').Difficulty;
  /**
   * Optional radius (metres) for the Street View service to search for the
   * nearest available panorama. Defaults are applied by the Street View hook.
   */
  radius?: number;
}

/** Result of a single completed round. */
export interface RoundResult {
  location: GameLocation;
  guess: LatLng;
  distanceKm: number;
  score: number;
}

/** User-adjustable preferences persisted in localStorage. */
export interface Preferences {
  /** Show the optional per-round timer. */
  timer: boolean;
  /** Distance units for display. */
  units: 'metric' | 'imperial';
  /** Reduce non-essential motion regardless of OS setting. */
  reduceMotion: boolean;
}

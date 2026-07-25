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
  /**
   * Continent / macro-region. Optional on the shared type so runtime data from
   * older manifests and stored snapshots stays valid; the curated catalog
   * (`CatalogLocation`) requires it, and `continentForCountry()` derives it as
   * a fallback. Drives in-match geographic diversity and continent collections.
   */
  continent?: import('../config/geography').Continent;
  /**
   * Curated collection tags (see `config/collections.ts`). Derived collections
   * — continents, Islands, Left-Side Driving — are computed from metadata and
   * must NOT appear here.
   */
  tags?: readonly import('../config/collections').CuratedTag[];
  /**
   * Explicit canonical group override. Set this when two entries are
   * *intentionally* different panoramas of the same place (e.g. two viewpoints
   * of one landmark) so the Diversity Engine treats them as one item and never
   * serves both to a player in quick succession. Leave unset for genuinely
   * distinct places — see `utils/canonicalGroup.ts`.
   */
  locationGroupId?: string;
  /**
   * Optionally pre-verified Street View panorama id. When present the Street
   * View layer can skip the nearest-panorama lookup; when absent the existing
   * radius-based resolution is used. Only ever populated by the verified
   * catalog import workflow, never guessed.
   */
  panoId?: string;
}

/**
 * A curated catalog entry. Identical to `GameLocation` except the diversity
 * metadata is *mandatory*, so a new location cannot be added to
 * `src/data/locations.ts` without a continent and an explicit (possibly empty)
 * tag list. Keeping `GameLocation` lenient preserves backwards compatibility
 * with stored runs and multiplayer manifests created before V4.
 */
export type CatalogLocation = GameLocation & {
  continent: import('../config/geography').Continent;
  tags: readonly import('../config/collections').CuratedTag[];
};

/** Result of a single completed round. */
export interface RoundResult {
  location: GameLocation;
  guess: LatLng;
  distanceKm: number;
  score: number;
}

/**
 * A fixed panorama target — a pre-resolved pano id + orientation rendered
 * without any lat/lng, so the answer stays hidden until guessed. Used by
 * multiplayer (both players see the identical view) and by solo run resume
 * (the current round's answer is never sent to the client until guessed).
 */
export interface PanoramaTarget {
  panoId: string;
  heading: number;
  pitch?: number;
  zoom?: number;
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

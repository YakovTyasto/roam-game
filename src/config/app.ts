/**
 * Central application configuration.
 *
 * The product name lives here and NOWHERE else in user-facing code, so the
 * game can be renamed by editing this single file. Import `APP` everywhere
 * you need the name, tagline, or tuning constants.
 */
export const APP = {
  /** Working title. Change this one value to rename the whole product. */
  name: 'Roam',
  tagline: 'Guess where in the world you are.',
  description:
    'Explore a Street View panorama, drop a pin on the map, and score points based on how close you get.',

  /** Number of rounds in a classic game. */
  roundsPerGame: 5,

  /** Maximum points awarded for a single perfect guess. */
  maxRoundScore: 5000,

  /**
   * Scoring falloff constant, in kilometres. Larger = more forgiving.
   * Used by the exponential scoring formula (see utils/score.ts).
   */
  scoreFalloffKm: 2000,

  /** localStorage key namespace. */
  storagePrefix: 'roam',
} as const;

export const MAX_GAME_SCORE = APP.maxRoundScore * APP.roundsPerGame;

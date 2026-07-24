/**
 * Difficulty presets — the single source of truth for solo and multiplayer.
 *
 * Both game modes read timers, labels, and descriptions from here so their
 * behaviour never drifts. The internal `Difficulty` values are stable and are
 * what the database stores; user-facing copy lives only in `DIFFICULTY_PRESETS`.
 */

/** Stable internal difficulty value. Persisted verbatim in the database. */
export type Difficulty = 'easy' | 'normal' | 'hard';

/** All difficulties in display order. */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'] as const;

/**
 * Default difficulty. Chosen so that the v2 "Normal" preset is equivalent to
 * the pre-v2 default experience (120s rounds, balanced pool) — this is also the
 * safe default applied to rooms created before the difficulty migration.
 */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export interface DifficultyPreset {
  id: Difficulty;
  /** Short user-facing name. */
  label: string;
  /** One-line description shown on the selection cards. */
  description: string;
  /** Per-round timer in seconds. */
  roundSeconds: number;
  /** Longer, plain-language hint about who the preset is for. */
  audience: string;
}

export const DIFFICULTY_PRESETS: Record<Difficulty, DifficultyPreset> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    description: 'Famous cities and landmarks with strong clues.',
    roundSeconds: 180,
    audience: 'New players',
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    description: 'A balanced mix of city, suburb, and countryside.',
    roundSeconds: 120,
    audience: 'The classic experience',
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    description: 'Remote, rural, and geographically tricky spots.',
    roundSeconds: 75,
    audience: 'Experienced explorers',
  },
};

/** Ordered list of presets for rendering the selection cards. */
export const DIFFICULTY_LIST: readonly DifficultyPreset[] = DIFFICULTIES.map(
  (d) => DIFFICULTY_PRESETS[d],
);

/** Type guard — accepts only known difficulty values. */
export function isDifficulty(value: unknown): value is Difficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

/** Coerce an unknown value to a valid difficulty, falling back to the default. */
export function toDifficulty(value: unknown): Difficulty {
  return isDifficulty(value) ? value : DEFAULT_DIFFICULTY;
}

/** User-facing label for a difficulty. */
export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTY_PRESETS[d].label;
}

/** Round timer (seconds) for a difficulty. */
export function difficultyRoundSeconds(d: Difficulty): number {
  return DIFFICULTY_PRESETS[d].roundSeconds;
}

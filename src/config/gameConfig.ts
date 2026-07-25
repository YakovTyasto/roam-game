import type { Difficulty } from './difficulty';
import { difficultyLabel, difficultyRoundSeconds, isDifficulty } from './difficulty';

/**
 * Typed source of truth for a single game's configuration — round count,
 * timer, difficulty, and a movement-rule placeholder for future modes
 * (No Move / NMPZ). Used by solo setup; the underlying values (round count,
 * timer) are already independently supported server-side for multiplayer
 * room creation (see supabase/migrations/0003, mp_create_room).
 */

export const QUICK_ROUND_COUNTS: readonly number[] = [3, 5, 10] as const;
export const MIN_CUSTOM_ROUNDS = 1;
export const MAX_CUSTOM_ROUNDS = 20;
export const MIN_TIMER_SECONDS = 15;
export const MAX_TIMER_SECONDS = 600;

/** Placeholder for future No Move / NMPZ modes — only 'default' exists today. */
export type MovementRule = 'default';

export interface GameConfig {
  difficulty: Difficulty;
  /** null = Endless (one round at a time, no fixed end). */
  roundCount: number | null;
  /** null = No Timer. */
  timerSeconds: number | null;
  movementRule: MovementRule;
}

export function isEndless(config: GameConfig): boolean {
  return config.roundCount === null;
}

export function clampRoundCount(n: number): number {
  return Math.min(MAX_CUSTOM_ROUNDS, Math.max(MIN_CUSTOM_ROUNDS, Math.round(n)));
}

export function clampTimerSeconds(n: number): number {
  return Math.min(MAX_TIMER_SECONDS, Math.max(MIN_TIMER_SECONDS, Math.round(n)));
}

/** A one-tap quick preset: the difficulty's own timer, no custom overrides. */
export function quickConfig(difficulty: Difficulty, roundCount: number | null): GameConfig {
  return {
    difficulty,
    roundCount: roundCount === null ? null : clampRoundCount(roundCount),
    timerSeconds: difficultyRoundSeconds(difficulty),
    movementRule: 'default',
  };
}

export interface RawGameConfig {
  difficulty?: unknown;
  roundCount?: unknown;
  timerSeconds?: unknown;
  movementRule?: unknown;
}

/** Validate/coerce an untrusted config (e.g. from local storage). */
export function validateGameConfig(
  raw: RawGameConfig,
): { ok: true; config: GameConfig } | { ok: false; error: string } {
  if (!isDifficulty(raw.difficulty)) {
    return { ok: false, error: 'Invalid difficulty.' };
  }

  let roundCount: number | null;
  if (raw.roundCount === null) {
    roundCount = null;
  } else if (typeof raw.roundCount === 'number' && Number.isFinite(raw.roundCount)) {
    if (raw.roundCount < MIN_CUSTOM_ROUNDS || raw.roundCount > MAX_CUSTOM_ROUNDS) {
      return { ok: false, error: `Round count must be between ${MIN_CUSTOM_ROUNDS} and ${MAX_CUSTOM_ROUNDS}.` };
    }
    roundCount = Math.round(raw.roundCount);
  } else {
    return { ok: false, error: 'Invalid round count.' };
  }

  let timerSeconds: number | null;
  if (raw.timerSeconds === null) {
    timerSeconds = null;
  } else if (typeof raw.timerSeconds === 'number' && Number.isFinite(raw.timerSeconds)) {
    if (raw.timerSeconds < MIN_TIMER_SECONDS || raw.timerSeconds > MAX_TIMER_SECONDS) {
      return { ok: false, error: `Timer must be between ${MIN_TIMER_SECONDS} and ${MAX_TIMER_SECONDS} seconds.` };
    }
    timerSeconds = Math.round(raw.timerSeconds);
  } else {
    return { ok: false, error: 'Invalid timer.' };
  }

  if (raw.movementRule !== undefined && raw.movementRule !== 'default') {
    return { ok: false, error: 'Invalid movement rule.' };
  }

  return {
    ok: true,
    config: { difficulty: raw.difficulty, roundCount, timerSeconds, movementRule: 'default' },
  };
}

/** e.g. "Hard · 10 rounds · 75 seconds" or "Normal · Endless · No timer". */
export function summarizeGameConfig(config: GameConfig): string {
  const parts = [difficultyLabel(config.difficulty)];
  parts.push(
    config.roundCount === null
      ? 'Endless'
      : `${config.roundCount} round${config.roundCount === 1 ? '' : 's'}`,
  );
  parts.push(config.timerSeconds === null ? 'No timer' : `${config.timerSeconds} seconds`);
  return parts.join(' · ');
}

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  DIFFICULTY_PRESETS,
  difficultyLabel,
  difficultyRoundSeconds,
  isDifficulty,
  toDifficulty,
} from './difficulty';

describe('difficulty presets', () => {
  it('defines exactly three presets in order', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
  });

  it('has the required timers per preset', () => {
    expect(difficultyRoundSeconds('easy')).toBe(180);
    expect(difficultyRoundSeconds('normal')).toBe(120);
    expect(difficultyRoundSeconds('hard')).toBe(75);
  });

  it('defaults to normal (parity with the pre-v2 experience)', () => {
    expect(DEFAULT_DIFFICULTY).toBe('normal');
    expect(difficultyRoundSeconds(DEFAULT_DIFFICULTY)).toBe(120);
  });

  it('exposes a non-empty label and description for each preset', () => {
    for (const d of DIFFICULTIES) {
      const preset = DIFFICULTY_PRESETS[d];
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(difficultyLabel(d)).toBe(preset.label);
    }
  });

  it('guards and coerces unknown values', () => {
    expect(isDifficulty('easy')).toBe(true);
    expect(isDifficulty('impossible')).toBe(false);
    expect(isDifficulty(null)).toBe(false);
    expect(toDifficulty('hard')).toBe('hard');
    expect(toDifficulty('nope')).toBe(DEFAULT_DIFFICULTY);
    expect(toDifficulty(undefined)).toBe(DEFAULT_DIFFICULTY);
  });
});

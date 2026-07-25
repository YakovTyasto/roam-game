import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_ROUNDS,
  MAX_TIMER_SECONDS,
  MIN_CUSTOM_ROUNDS,
  MIN_TIMER_SECONDS,
  clampRoundCount,
  clampTimerSeconds,
  isEndless,
  quickConfig,
  summarizeGameConfig,
  validateGameConfig,
} from './gameConfig';

describe('quickConfig', () => {
  it('derives the timer from the difficulty preset', () => {
    expect(quickConfig('hard', 10)).toEqual({
      difficulty: 'hard',
      roundCount: 10,
      timerSeconds: 75,
      movementRule: 'default',
    });
  });

  it('represents Endless as a null round count', () => {
    const config = quickConfig('normal', null);
    expect(isEndless(config)).toBe(true);
    expect(config.roundCount).toBeNull();
  });
});

describe('clamp helpers', () => {
  it('clamps round count into [1, 20]', () => {
    expect(clampRoundCount(0)).toBe(MIN_CUSTOM_ROUNDS);
    expect(clampRoundCount(999)).toBe(MAX_CUSTOM_ROUNDS);
    expect(clampRoundCount(7.6)).toBe(8);
  });

  it('clamps timer seconds into [15, 600]', () => {
    expect(clampTimerSeconds(1)).toBe(MIN_TIMER_SECONDS);
    expect(clampTimerSeconds(9999)).toBe(MAX_TIMER_SECONDS);
  });
});

describe('validateGameConfig', () => {
  it('accepts a valid fixed config', () => {
    const result = validateGameConfig({
      difficulty: 'easy',
      roundCount: 12,
      timerSeconds: 90,
    });
    expect(result).toEqual({
      ok: true,
      config: { difficulty: 'easy', roundCount: 12, timerSeconds: 90, movementRule: 'default' },
    });
  });

  it('accepts Endless (null round count) and No Timer (null timer)', () => {
    const result = validateGameConfig({ difficulty: 'normal', roundCount: null, timerSeconds: null });
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid difficulty', () => {
    const result = validateGameConfig({ difficulty: 'extreme', roundCount: 5, timerSeconds: 120 });
    expect(result.ok).toBe(false);
  });

  it('rejects a round count outside [1, 20]', () => {
    expect(validateGameConfig({ difficulty: 'normal', roundCount: 0, timerSeconds: 120 }).ok).toBe(false);
    expect(validateGameConfig({ difficulty: 'normal', roundCount: 21, timerSeconds: 120 }).ok).toBe(false);
  });

  it('rejects a timer outside [15, 600]', () => {
    expect(validateGameConfig({ difficulty: 'normal', roundCount: 5, timerSeconds: 5 }).ok).toBe(false);
    expect(validateGameConfig({ difficulty: 'normal', roundCount: 5, timerSeconds: 601 }).ok).toBe(false);
  });

  it('rejects a malformed movement rule', () => {
    const result = validateGameConfig({
      difficulty: 'normal',
      roundCount: 5,
      timerSeconds: 120,
      movementRule: 'no-move',
    });
    expect(result.ok).toBe(false);
  });
});

describe('summarizeGameConfig', () => {
  it('formats a fixed config', () => {
    expect(summarizeGameConfig(quickConfig('hard', 10))).toBe('Hard · 10 rounds · 75 seconds');
  });

  it('formats a singular round count', () => {
    expect(summarizeGameConfig(quickConfig('easy', 1))).toBe('Easy · 1 round · 180 seconds');
  });

  it('formats Endless and No Timer', () => {
    expect(
      summarizeGameConfig({ difficulty: 'normal', roundCount: null, timerSeconds: null, movementRule: 'default' }),
    ).toBe('Normal · Endless · No timer');
  });
});

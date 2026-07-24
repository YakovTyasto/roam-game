import { describe, it, expect } from 'vitest';
import { isRoundExpired, remainingSeconds, toEpochMs } from './timer';

const START = 1_000_000_000_000; // arbitrary epoch ms
const DURATION = 120;

describe('remainingSeconds', () => {
  it('returns the full duration at the start', () => {
    expect(remainingSeconds(START, DURATION, START)).toBe(DURATION);
  });

  it('counts down as server time advances', () => {
    expect(remainingSeconds(START, DURATION, START + 30_000)).toBe(90);
    expect(remainingSeconds(START, DURATION, START + 119_000)).toBe(1);
  });

  it('clamps to zero and never goes negative', () => {
    expect(remainingSeconds(START, DURATION, START + 121_000)).toBe(0);
    expect(remainingSeconds(START, DURATION, START + 10_000_000)).toBe(0);
  });

  it('returns the full duration when the round has not started', () => {
    expect(remainingSeconds(null, DURATION, START)).toBe(DURATION);
  });
});

describe('isRoundExpired', () => {
  it('is false before the deadline', () => {
    expect(isRoundExpired(START, DURATION, START + 119_999)).toBe(false);
  });

  it('is true at/after the deadline (matches the SQL >= guard)', () => {
    expect(isRoundExpired(START, DURATION, START + 120_000)).toBe(true);
    expect(isRoundExpired(START, DURATION, START + 500_000)).toBe(true);
  });

  it('is never expired without a start time', () => {
    expect(isRoundExpired(null, DURATION, START + 999_999)).toBe(false);
  });
});

describe('toEpochMs', () => {
  it('parses an ISO timestamp', () => {
    expect(toEpochMs('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('returns null for empty / invalid input', () => {
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs('')).toBeNull();
    expect(toEpochMs('not-a-date')).toBeNull();
  });
});

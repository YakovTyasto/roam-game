import { describe, expect, it } from 'vitest';
import { formatCountdown, msUntilWeekEnd, weekEnd, weekStart } from './weeks';

const iso = (d: Date) => d.toISOString();

describe('leaderboard week boundaries (UTC, Monday-based)', () => {
  it('maps Monday 00:00 UTC to itself', () => {
    // 2024-01-01 is a Monday.
    expect(iso(weekStart(new Date('2024-01-01T00:00:00Z')))).toBe(
      '2024-01-01T00:00:00.000Z',
    );
  });

  it('keeps Sunday 23:59 UTC in the same week', () => {
    expect(iso(weekStart(new Date('2024-01-07T23:59:59Z')))).toBe(
      '2024-01-01T00:00:00.000Z',
    );
  });

  it('rolls over at the next Monday 00:00 UTC', () => {
    expect(iso(weekStart(new Date('2024-01-08T00:00:00Z')))).toBe(
      '2024-01-08T00:00:00.000Z',
    );
  });

  it('handles mid-week (Thursday) correctly', () => {
    expect(iso(weekStart(new Date('2024-01-04T15:30:00Z')))).toBe(
      '2024-01-01T00:00:00.000Z',
    );
  });

  it('computes the week end as the following Monday', () => {
    expect(iso(weekEnd(new Date('2024-01-03T12:00:00Z')))).toBe(
      '2024-01-08T00:00:00.000Z',
    );
  });

  it('does not shift the boundary across a UTC day even late in the day', () => {
    // A Sunday late-evening UTC time must still belong to the week that began
    // the previous Monday, regardless of the host machine's local timezone.
    expect(iso(weekStart(new Date('2024-03-17T23:30:00Z')))).toBe(
      '2024-03-11T00:00:00.000Z',
    );
  });
});

describe('countdown helpers', () => {
  it('reports the time remaining until the week ends', () => {
    const now = new Date('2024-01-07T00:00:00Z'); // Sunday
    // One day until Monday 2024-01-08T00:00Z.
    expect(msUntilWeekEnd(now)).toBe(24 * 60 * 60 * 1000);
  });

  it('never returns a negative remaining time', () => {
    expect(msUntilWeekEnd(new Date('2024-01-08T00:00:00Z'))).toBeGreaterThanOrEqual(0);
  });

  it('formats a compact countdown', () => {
    expect(formatCountdown(2 * 86400000 + 4 * 3600000)).toBe('2d 4h');
    expect(formatCountdown(3 * 3600000 + 12 * 60000)).toBe('3h 12m');
    expect(formatCountdown(8 * 60000)).toBe('8m');
  });
});

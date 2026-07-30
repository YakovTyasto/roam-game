import { describe, expect, it } from 'vitest';
import {
  compareDailyEntries,
  dailyCardState,
  formatCountdown,
  formatDuration,
  nextUtcMidnight,
  parseDailyLeaderboard,
  parseDailyStatus,
  secondsUntilNextDay,
  utcDayOf,
} from './daily';

describe('UTC day boundaries', () => {
  it('uses the UTC calendar day, not the local one', () => {
    // 23:30 on the 30th in UTC+2 is still the 30th in UTC; 00:30 on the 31st in
    // UTC+2 is the 30th in UTC. A local-date implementation gets both wrong.
    expect(utcDayOf(new Date('2026-07-30T21:30:00Z'))).toBe('2026-07-30');
    expect(utcDayOf(new Date('2026-07-30T22:30:00Z'))).toBe('2026-07-30');
    expect(utcDayOf(new Date('2026-07-31T00:00:00Z'))).toBe('2026-07-31');
  });

  it('rolls over exactly at midnight UTC', () => {
    expect(utcDayOf(new Date('2026-07-30T23:59:59.999Z'))).toBe('2026-07-30');
    expect(utcDayOf(new Date('2026-07-31T00:00:00.000Z'))).toBe('2026-07-31');
  });

  it('nextUtcMidnight is the following 00:00Z', () => {
    expect(nextUtcMidnight(new Date('2026-07-30T13:45:12Z')).toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
    // Already at midnight → the NEXT one, never the same instant (a countdown of
    // zero that never advances would look like a broken clock).
    expect(nextUtcMidnight(new Date('2026-07-30T00:00:00Z')).toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
  });

  it('handles month and year rollover', () => {
    expect(nextUtcMidnight(new Date('2026-07-31T12:00:00Z')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(nextUtcMidnight(new Date('2026-12-31T12:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    // Leap day.
    expect(nextUtcMidnight(new Date('2028-02-28T12:00:00Z')).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });
});

const statusPayload = (overrides: Record<string, unknown> = {}) => ({
  utc_day: '2026-07-30',
  server_now: '2026-07-30T22:00:00Z',
  next_day_at: '2026-07-31T00:00:00Z',
  round_count: 5,
  difficulty: 'normal',
  timer_seconds: 120,
  players_completed: 412,
  attempt: null,
  previous: null,
  ...overrides,
});

describe('countdown', () => {
  it('counts down from the SERVER clock, not the device clock', () => {
    const status = parseDailyStatus(statusPayload())!;
    // 22:00Z → 00:00Z is two hours, whatever the device believes.
    expect(secondsUntilNextDay(status)).toBe(7200);
  });

  it('advances with local elapsed time while staying server-anchored', () => {
    const status = parseDailyStatus(statusPayload())!;
    expect(secondsUntilNextDay(status, 60_000)).toBe(7140);
  });

  it('never goes negative once the day has rolled over', () => {
    const status = parseDailyStatus(statusPayload())!;
    expect(secondsUntilNextDay(status, 10 * 3600 * 1000)).toBe(0);
  });

  it('derives the target when the server omits it', () => {
    const status = parseDailyStatus(statusPayload({ next_day_at: null }))!;
    expect(status.nextDayAt.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(secondsUntilNextDay(status)).toBe(7200);
  });

  it('formats as H:MM:SS', () => {
    expect(formatCountdown(7200)).toBe('2:00:00');
    expect(formatCountdown(59)).toBe('0:00:59');
    expect(formatCountdown(3661)).toBe('1:01:01');
    expect(formatCountdown(-5)).toBe('0:00:00');
  });
});

describe('duration formatting', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(125_000)).toBe('2:05');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('rolls into hours for a very long game', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('returns null for a missing or nonsensical duration', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});

describe('parseDailyStatus', () => {
  it('reports a fresh player as not started', () => {
    const status = parseDailyStatus(statusPayload())!;
    expect(status.attempt).toBeNull();
    expect(dailyCardState(status)).toBe('not-started');
    expect(status.playersCompleted).toBe(412);
  });

  it('reports an in-progress attempt with its progress', () => {
    const status = parseDailyStatus(
      statusPayload({ attempt: { status: 'active', rounds_played: 3, total_score: 12000 } }),
    )!;
    expect(dailyCardState(status)).toBe('in-progress');
    expect(status.attempt!.roundsPlayed).toBe(3);
  });

  it('reports a completed attempt with its rank', () => {
    const status = parseDailyStatus(
      statusPayload({
        attempt: {
          status: 'complete',
          total_score: 21500,
          total_distance_km: 190.5,
          duration_ms: 245_000,
          completed_at: '2026-07-30T21:00:00Z',
          rank: 7,
          rounds_played: 5,
        },
      }),
    )!;
    expect(dailyCardState(status)).toBe('completed');
    expect(status.attempt!.rank).toBe(7);
    expect(formatDuration(status.attempt!.durationMs)).toBe('4:05');
  });

  it('parses the previous day summary when present', () => {
    const status = parseDailyStatus(
      statusPayload({
        previous: { utc_day: '2026-07-29', total_score: 18000, total_distance_km: 500 },
      }),
    )!;
    expect(status.previous!.utcDay).toBe('2026-07-29');
    expect(status.previous!.durationMs).toBeNull();
  });

  it('treats an unusable payload as unavailable rather than throwing', () => {
    expect(parseDailyStatus(null)).toBeNull();
    expect(parseDailyStatus({})).toBeNull();
    expect(parseDailyStatus('nope')).toBeNull();
    expect(dailyCardState(null)).toBe('unavailable');
  });
});

describe('leaderboard parsing', () => {
  it('sorts by rank and keeps the caller’s own row', () => {
    const board = parseDailyLeaderboard({
      utc_day: '2026-07-30',
      server_now: '2026-07-30T22:00:00Z',
      entries: [
        { rank: 2, display_name: 'Blake', total_score: 20000, total_distance_km: 500 },
        { rank: 1, display_name: 'Ada', total_score: 20000, total_distance_km: 100 },
      ],
      self: { rank: 42, display_name: 'Me', total_score: 15000, total_distance_km: 900, is_self: true },
    })!;
    expect(board.entries.map((e) => e.displayName)).toEqual(['Ada', 'Blake']);
    expect(board.self!.rank).toBe(42);
  });

  it('drops malformed entries instead of failing the whole board', () => {
    const board = parseDailyLeaderboard({
      utc_day: '2026-07-30',
      entries: [{ rank: 1, display_name: 'Ada' }, null, { display_name: 'no rank' }],
    })!;
    expect(board.entries).toHaveLength(1);
  });

  it('never surfaces a user id, because the server never sends one', () => {
    const board = parseDailyLeaderboard({
      utc_day: '2026-07-30',
      entries: [{ rank: 1, display_name: 'Ada', user_id: 'leaked-uuid' }],
    })!;
    expect(JSON.stringify(board)).not.toContain('leaked-uuid');
  });
});

describe('tie-break order', () => {
  const entry = (
    totalScore: number,
    totalDistanceKm: number,
    durationMs: number | null,
    completedAt: string | null,
  ) => ({
    totalScore,
    totalDistanceKm,
    durationMs,
    completedAt: completedAt ? new Date(completedAt) : null,
  });

  it('1. higher score wins, even against a closer, faster player', () => {
    const better = entry(20000, 900, 999_000, '2026-07-30T23:00:00Z');
    const worse = entry(19999, 1, 1000, '2026-07-30T01:00:00Z');
    expect(compareDailyEntries(better, worse)).toBeLessThan(0);
  });

  it('2. equal score → lower total distance wins', () => {
    expect(
      compareDailyEntries(entry(20000, 100, 999_000, null), entry(20000, 500, 1000, null)),
    ).toBeLessThan(0);
  });

  it('3. equal score and distance → shorter duration wins', () => {
    expect(
      compareDailyEntries(
        entry(20000, 100, 60_000, '2026-07-30T23:00:00Z'),
        entry(20000, 100, 120_000, '2026-07-30T01:00:00Z'),
      ),
    ).toBeLessThan(0);
  });

  it('4. all equal → earlier completion wins', () => {
    expect(
      compareDailyEntries(
        entry(20000, 100, 60_000, '2026-07-30T01:00:00Z'),
        entry(20000, 100, 60_000, '2026-07-30T02:00:00Z'),
      ),
    ).toBeLessThan(0);
  });

  it('a missing duration never wins a tiebreak against a measured one', () => {
    expect(
      compareDailyEntries(entry(20000, 100, null, null), entry(20000, 100, 999_999, null)),
    ).toBeGreaterThan(0);
  });

  it('is a total order: sorting is stable and reproducible', () => {
    const list = [
      entry(19000, 1, 1000, '2026-07-30T01:00:00Z'),
      entry(20000, 500, 1000, '2026-07-30T01:00:00Z'),
      entry(20000, 100, 300_000, '2026-07-30T01:00:00Z'),
    ];
    const once = [...list].sort(compareDailyEntries);
    const twice = [...once].sort(compareDailyEntries);
    expect(twice).toEqual(once);
    expect(once[0].totalDistanceKm).toBe(100);
    expect(once[2].totalScore).toBe(19000);
  });
});

/**
 * Pure Daily Challenge logic: payload parsing, the UTC day boundary, the
 * countdown, and the documented tie-break order.
 *
 * No Supabase import, so every rule here is unit-testable — and the UTC boundary
 * in particular deserves that: "which day is it?" is the one thing a player will
 * notice being wrong, and a local-timezone bug is invisible to anyone developing
 * in UTC+0.
 *
 * The server is the authority for the day and for every deadline. Everything
 * here works from the server's `server_now`, never from `Date.now()`, so a device
 * with a wrong clock shows the right countdown.
 */

export type DailyAttemptStatus = 'active' | 'complete' | 'abandoned';

export interface DailyAttemptSummary {
  status: DailyAttemptStatus;
  totalScore: number;
  totalDistanceKm: number;
  durationMs: number | null;
  completedAt: Date | null;
  /** Rank among completed attempts, once complete. */
  rank: number | null;
  roundsPlayed: number;
}

export interface DailyPreviousSummary {
  utcDay: string;
  totalScore: number;
  totalDistanceKm: number;
  durationMs: number | null;
}

export interface DailyStatus {
  /** ISO date (YYYY-MM-DD) of the current UTC challenge day. */
  utcDay: string;
  serverNow: Date;
  /** When the next challenge opens — always midnight UTC. */
  nextDayAt: Date;
  roundCount: number;
  difficulty: string;
  timerSeconds: number;
  /** How many players have finished today's challenge. */
  playersCompleted: number;
  attempt: DailyAttemptSummary | null;
  previous: DailyPreviousSummary | null;
}

export interface DailyLeaderboardEntry {
  rank: number;
  displayName: string;
  totalScore: number;
  totalDistanceKm: number;
  durationMs: number | null;
  completedAt: Date | null;
  isSelf: boolean;
}

export interface DailyLeaderboard {
  utcDay: string;
  entries: DailyLeaderboardEntry[];
  /** The caller's own row, present even when outside the returned slice. */
  self: DailyLeaderboardEntry | null;
  serverNow: Date;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function optNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
function date(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The UTC calendar day (YYYY-MM-DD) containing `at`. */
export function utcDayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Midnight UTC that starts the day AFTER the one containing `at`. */
export function nextUtcMidnight(at: Date): Date {
  const next = new Date(at);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Whole seconds until the next challenge, measured from the server's clock.
 *
 * `elapsedSinceFetchMs` lets the UI tick without re-fetching: the caller adds
 * however long the page has been open. That keeps the countdown honest — it
 * advances with local elapsed time but stays anchored to the server's notion of
 * now, so a device clock that is a day off does not change the answer.
 */
export function secondsUntilNextDay(status: DailyStatus, elapsedSinceFetchMs = 0): number {
  const remainingMs = status.nextDayAt.getTime() - (status.serverNow.getTime() + elapsedSinceFetchMs);
  return Math.max(0, Math.floor(remainingMs / 1000));
}

/** `H:MM:SS` for a countdown; hours are not zero-padded (they read as a number). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

/** `M:SS` for a completion duration. Long games roll into hours. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds >= 3600) return formatCountdown(totalSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function parseDailyStatus(data: unknown): DailyStatus | null {
  const o = rec(data);
  if (!o) return null;
  const utcDay = str(o.utc_day);
  if (!utcDay) return null;

  const serverNow = date(o.server_now) ?? new Date();
  const attemptRaw = rec(o.attempt);
  const previousRaw = rec(o.previous);

  return {
    utcDay,
    serverNow,
    // Trust the server's value, but never leave the countdown without a target:
    // deriving it from the server's own `now` is exactly as correct.
    nextDayAt: date(o.next_day_at) ?? nextUtcMidnight(serverNow),
    roundCount: num(o.round_count, 5),
    difficulty: str(o.difficulty, 'normal'),
    timerSeconds: num(o.timer_seconds, 120),
    playersCompleted: num(o.players_completed, 0),
    attempt: attemptRaw
      ? {
          status:
            attemptRaw.status === 'complete' || attemptRaw.status === 'abandoned'
              ? attemptRaw.status
              : 'active',
          totalScore: num(attemptRaw.total_score),
          totalDistanceKm: num(attemptRaw.total_distance_km),
          durationMs: optNum(attemptRaw.duration_ms),
          completedAt: date(attemptRaw.completed_at),
          rank: optNum(attemptRaw.rank),
          roundsPlayed: num(attemptRaw.rounds_played),
        }
      : null,
    previous: previousRaw
      ? {
          utcDay: str(previousRaw.utc_day),
          totalScore: num(previousRaw.total_score),
          totalDistanceKm: num(previousRaw.total_distance_km),
          durationMs: optNum(previousRaw.duration_ms),
        }
      : null,
  };
}

function parseEntry(raw: unknown): DailyLeaderboardEntry | null {
  const o = rec(raw);
  if (!o) return null;
  const rank = optNum(o.rank);
  if (rank === null) return null;
  return {
    rank,
    displayName: str(o.display_name, 'Player'),
    totalScore: num(o.total_score),
    totalDistanceKm: num(o.total_distance_km),
    durationMs: optNum(o.duration_ms),
    completedAt: date(o.completed_at),
    isSelf: o.is_self === true,
  };
}

export function parseDailyLeaderboard(data: unknown): DailyLeaderboard | null {
  const o = rec(data);
  if (!o) return null;
  const rawEntries = Array.isArray(o.entries) ? o.entries : [];
  return {
    utcDay: str(o.utc_day),
    entries: rawEntries
      .map(parseEntry)
      .filter((e): e is DailyLeaderboardEntry => e !== null)
      .sort((a, b) => a.rank - b.rank),
    self: parseEntry(o.self),
    serverNow: date(o.server_now) ?? new Date(),
  };
}

/**
 * The documented Daily tie-break order, as a comparator.
 *
 *   1. higher total score
 *   2. lower total distance
 *   3. shorter completion duration
 *   4. earlier completion time
 *
 * This mirrors `roam_daily_leaderboard` (migration 0016) — which is the actual
 * authority. It exists here so the *client* can order a locally-assembled list
 * (e.g. a challenge result page) the same way, and so the rule is asserted by a
 * unit test as well as a SQL one. A missing duration sorts last: an attempt with
 * no measured duration must never win a tiebreak against one that has it.
 */
export function compareDailyEntries(
  a: Pick<DailyLeaderboardEntry, 'totalScore' | 'totalDistanceKm' | 'durationMs' | 'completedAt'>,
  b: Pick<DailyLeaderboardEntry, 'totalScore' | 'totalDistanceKm' | 'durationMs' | 'completedAt'>,
): number {
  if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
  if (a.totalDistanceKm !== b.totalDistanceKm) return a.totalDistanceKm - b.totalDistanceKm;
  const aDur = a.durationMs ?? Number.POSITIVE_INFINITY;
  const bDur = b.durationMs ?? Number.POSITIVE_INFINITY;
  if (aDur !== bDur) return aDur - bDur;
  const aAt = a.completedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bAt = b.completedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return aAt - bAt;
}

/** What the Daily card should offer right now. */
export type DailyCardState =
  | 'unavailable'
  | 'not-started'
  | 'in-progress'
  | 'completed';

export function dailyCardState(status: DailyStatus | null): DailyCardState {
  if (!status) return 'unavailable';
  if (!status.attempt) return 'not-started';
  if (status.attempt.status === 'complete') return 'completed';
  return 'in-progress';
}

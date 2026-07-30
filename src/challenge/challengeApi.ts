import { getSupabase } from '../multiplayer/supabaseClient';
import { ensureAnonymousSession } from '../multiplayer/auth';
import { withTimeout } from '../utils/withTimeout';
import type { OfficialRun } from '../official/officialRun';
import { parseOfficialRun } from '../official/officialRun';
import type { DailyLeaderboard } from '../daily/daily';
import { parseDailyLeaderboard } from '../daily/daily';

/**
 * Supabase calls for shared challenges (migration 0017).
 *
 * The leaderboard shape is identical to the Daily one — same columns, same
 * documented tie-break order — so it reuses that parser rather than growing a
 * second copy that could drift.
 */

const LOOKUP_TIMEOUT_MS = 8_000;
const CREATE_TIMEOUT_MS = 12_000;
const START_TIMEOUT_MS = 12_000;

export interface ChallengeAttemptSummary {
  status: 'active' | 'complete' | 'abandoned';
  totalScore: number;
  totalDistanceKm: number;
  durationMs: number | null;
  completedAt: string | null;
  roundsPlayed: number;
}

export interface ChallengeInfo {
  code: string;
  title: string;
  difficulty: string;
  roundCount: number;
  timerSeconds: number | null;
  expiresAt: string;
  createdAt: string;
  isCreator: boolean;
  creatorName: string;
  playersCompleted: number;
  attempt: ChallengeAttemptSummary | null;
}

/** Why a challenge cannot be played. Drives the error screen's wording. */
export type ChallengeUnavailableReason = 'not_found' | 'expired' | 'offline';

export type ChallengeLookup =
  | { playable: true; info: ChallengeInfo }
  | { playable: false; reason: ChallengeUnavailableReason; title?: string };

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function n(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export async function createChallenge(options: {
  difficulty: string;
  roundCount: 5 | 10;
  timerSeconds: number | null;
  title: string;
  expiresHours: number;
}): Promise<{ code: string; title: string; expiresAt: string }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Challenges need an online connection.');
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_create_challenge_v2', {
      p_difficulty: options.difficulty,
      p_round_count: options.roundCount,
      p_timer_seconds: options.timerSeconds,
      p_title: options.title,
      p_expires_hours: options.expiresHours,
    }),
    CREATE_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  const o = rec(data);
  if (!s(o.code)) throw new Error('The challenge could not be created.');
  return { code: s(o.code), title: s(o.title), expiresAt: s(o.expires_at) };
}

/**
 * Look a challenge up by code. A missing/expired challenge is a *result*, not an
 * exception — only a transport failure throws, and that becomes `offline` so the
 * UI can offer a retry instead of claiming the link is bad.
 */
export async function lookupChallenge(code: string): Promise<ChallengeLookup> {
  const supabase = getSupabase();
  if (!supabase) return { playable: false, reason: 'offline' };
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_get_challenge_v2', { p_code: code }),
    LOOKUP_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);

  const o = rec(data);
  if (o.playable !== true) {
    const reason = o.reason === 'expired' ? 'expired' : 'not_found';
    return { playable: false, reason, title: s(o.title) || undefined };
  }

  const attemptRaw = o.attempt ? rec(o.attempt) : null;
  return {
    playable: true,
    info: {
      code: s(o.code),
      title: s(o.title),
      difficulty: s(o.difficulty, 'normal'),
      roundCount: n(o.round_count, 5),
      timerSeconds: typeof o.timer_seconds === 'number' ? o.timer_seconds : null,
      expiresAt: s(o.expires_at),
      createdAt: s(o.created_at),
      isCreator: o.is_creator === true,
      creatorName: s(o.creator_name, 'Player'),
      playersCompleted: n(o.players_completed),
      attempt: attemptRaw
        ? {
            status:
              attemptRaw.status === 'complete' || attemptRaw.status === 'abandoned'
                ? attemptRaw.status
                : 'active',
            totalScore: n(attemptRaw.total_score),
            totalDistanceKm: n(attemptRaw.total_distance_km),
            durationMs:
              typeof attemptRaw.duration_ms === 'number' ? attemptRaw.duration_ms : null,
            completedAt: s(attemptRaw.completed_at) || null,
            roundsPlayed: n(attemptRaw.rounds_played),
          }
        : null,
    },
  };
}

export type ChallengeStartOutcome =
  | { kind: 'started'; run: OfficialRun; resumed: boolean; hasTimer: boolean }
  | { kind: 'already-completed'; totalScore: number };

export async function startChallenge(code: string): Promise<ChallengeStartOutcome> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Challenges need an online connection.');
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_start_challenge_v2', { p_code: code }),
    START_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);

  const o = rec(data);
  if (o.started !== true) {
    return { kind: 'already-completed', totalScore: n(o.total_score) };
  }
  const run = parseOfficialRun(o.run);
  if (!run) throw new Error('The server did not return a playable challenge.');
  return { kind: 'started', run, resumed: o.resumed === true, hasTimer: o.has_timer === true };
}

export async function fetchChallengeLeaderboard(
  code: string,
  limit = 25,
): Promise<DailyLeaderboard | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_challenge_leaderboard', { p_code: code, p_limit: limit }),
    LOOKUP_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return parseDailyLeaderboard(data);
}

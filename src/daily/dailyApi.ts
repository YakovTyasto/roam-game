import { getSupabase } from '../multiplayer/supabaseClient';
import { ensureAnonymousSession } from '../multiplayer/auth';
import { withTimeout } from '../utils/withTimeout';
import type { OfficialRun } from '../official/officialRun';
import { parseOfficialRun } from '../official/officialRun';
import type { DailyLeaderboard, DailyStatus } from './daily';
import { parseDailyLeaderboard, parseDailyStatus } from './daily';

/**
 * Supabase calls for the Daily Challenge (migration 0016). Dynamically imported,
 * like every other module that touches the Supabase SDK.
 *
 * All three calls are bounded. The status call in particular sits behind the home
 * screen's Daily card, so it must fail fast and visibly rather than leaving a
 * spinner where a button should be — one backend feature being down must never
 * take the rest of the app with it.
 */

const STATUS_TIMEOUT_MS = 8_000;
const START_TIMEOUT_MS = 12_000;
const LEADERBOARD_TIMEOUT_MS = 10_000;

/** Today's challenge state for this player. Never generates the challenge. */
export async function fetchDailyStatus(): Promise<DailyStatus | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_daily_status'),
    STATUS_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return parseDailyStatus(data);
}

export type DailyStartOutcome =
  | { kind: 'started'; run: OfficialRun; resumed: boolean; practice: boolean; utcDay: string }
  /** The official attempt for today is already finished — not an error. */
  | { kind: 'already-completed'; utcDay: string; totalScore: number };

/**
 * Start (or resume) today's attempt. Practice is only accepted by the server once
 * the official attempt is complete, so passing `practice: true` earlier throws —
 * that guard lives server-side on purpose: a client-side check would be trivially
 * bypassable and would hand out the answers.
 */
export async function startDaily(practice = false): Promise<DailyStartOutcome> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The Daily Challenge needs an online connection.');
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_start_daily_v2', { p_practice: practice }),
    START_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);

  const o = (data ?? {}) as Record<string, unknown>;
  const utcDay = typeof o.utc_day === 'string' ? o.utc_day : '';
  if (o.started !== true) {
    return {
      kind: 'already-completed',
      utcDay,
      totalScore: typeof o.total_score === 'number' ? o.total_score : 0,
    };
  }
  const run = parseOfficialRun(o.run);
  if (!run) throw new Error('The server did not return a playable challenge.');
  return {
    kind: 'started',
    run,
    resumed: o.resumed === true,
    practice: o.practice === true,
    utcDay,
  };
}

/**
 * Today's (or a past day's) leaderboard. A future day is refused by the server;
 * that surfaces as a thrown error, which is correct — the UI has no legitimate
 * reason to ask.
 */
export async function fetchDailyLeaderboard(
  day?: string,
  limit = 50,
): Promise<DailyLeaderboard | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_daily_leaderboard', { p_day: day ?? null, p_limit: limit }),
    LEADERBOARD_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return parseDailyLeaderboard(data);
}

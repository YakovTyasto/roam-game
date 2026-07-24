import { getSupabase } from '../multiplayer/supabaseClient';
import { ensureAnonymousSession } from '../multiplayer/auth';
import { toDifficulty } from '../config/difficulty';
import type { LeaderboardData, LeaderboardEntry, LeaderboardMode } from './types';

/**
 * Supabase-backed leaderboard read. Dynamically imported (keeps the Supabase
 * SDK out of the main bundle). Reads go through the sanitized `roam_leaderboard`
 * RPC — the client never touches game_results directly.
 */

function parseEntry(raw: unknown): LeaderboardEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.rank !== 'number') return null;
  return {
    rank: o.rank,
    displayName: typeof o.display_name === 'string' ? o.display_name : 'Player',
    bestScore: Number(o.best_score ?? 0),
    gamesCompleted: Number(o.games_completed ?? 0),
    wins: Number(o.wins ?? 0),
    avgScore: Number(o.avg_score ?? 0),
    isSelf: o.is_self === true,
  };
}

export async function fetchLeaderboard(
  mode: LeaderboardMode,
  difficulty: string,
  limit = 50,
): Promise<LeaderboardData> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');
  await ensureAnonymousSession();

  const { data, error } = await supabase.rpc('roam_leaderboard', {
    p_mode: mode,
    p_difficulty: difficulty,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  const o = (data ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(o.entries)
    ? o.entries.map(parseEntry).filter((e): e is LeaderboardEntry => e !== null)
    : [];
  const self = parseEntry(o.self);

  return {
    weekStart: typeof o.week_start === 'string' ? o.week_start : '',
    weekEnd: typeof o.week_end === 'string' ? o.week_end : '',
    mode,
    difficulty: toDifficulty(difficulty),
    entries,
    self,
  };
}

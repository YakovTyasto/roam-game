import { getSupabase } from '../multiplayer/supabaseClient';
import { ensureAnonymousSession } from '../multiplayer/auth';
import type { Difficulty } from '../config/difficulty';
import type { CollectionId } from '../config/collections';

/**
 * Supabase-backed durable location history (migration 0011).
 *
 * Dynamically imported by the sync layer so the Supabase SDK stays out of the
 * main bundle — solo play with no backend must never pay for this.
 *
 * The client sends only opaque canonical group ids. It never sends a user id
 * (identity comes from `auth.uid()` server-side) and never receives anyone
 * else's history.
 */

/** Play mode a place was seen in. Mirrors the SQL check constraint. */
export type HistoryMode = 'solo' | 'endless' | 'multiplayer' | 'daily' | 'challenge' | 'streak';

export interface HistoryMeta {
  difficulty: Difficulty;
  collection: CollectionId;
  mode: HistoryMode;
}

/** Push played places to the durable history. Resolves to how many landed. */
export async function pushLocationHistory(
  groupIds: readonly string[],
  meta: HistoryMeta,
): Promise<number> {
  const supabase = getSupabase();
  if (!supabase || groupIds.length === 0) return 0;
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc('roam_record_location_history', {
    p_group_ids: [...groupIds],
    p_difficulty: meta.difficulty,
    p_collection: meta.collection,
    p_mode: meta.mode,
  });
  if (error) throw new Error(error.message);
  const recorded = (data as { recorded?: unknown } | null)?.recorded;
  return typeof recorded === 'number' ? recorded : 0;
}

/**
 * The caller's own durable history, newest-first. Returns `[]` rather than
 * throwing when Supabase is not configured, so every caller can treat "no
 * backend" and "empty history" identically.
 */
export async function fetchLocationHistory(): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc('roam_get_location_history', { p_limit: null });
  if (error) throw new Error(error.message);
  return parseGroups(data);
}

/** Clear the caller's durable history. Explicit — never implied by a local reset. */
export async function resetServerLocationHistory(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await ensureAnonymousSession();
  const { error } = await supabase.rpc('roam_reset_location_history');
  if (error) throw new Error(error.message);
}

/**
 * Defensive parsing: an unexpected payload degrades to "no server history"
 * rather than corrupting the local cache with junk. The local cache is what
 * selection reads, so it must never be poisoned by a malformed response.
 */
function parseGroups(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const groups = (data as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [];
  return groups.filter((g): g is string => typeof g === 'string' && g.length > 0);
}

import { getSupabase } from '../multiplayer/supabaseClient';
import { ensureAnonymousSession } from '../multiplayer/auth';
import type { ManifestRound } from '../multiplayer/types';
import type { Json } from '../multiplayer/database.types';

/**
 * Supabase-backed solo-run operations for the server-authoritative leaderboard
 * flow. Dynamically imported so the Supabase SDK stays out of the main bundle.
 * The client never submits a final score — the server scores each guess and
 * finalizes the run.
 */

export async function createSoloRun(
  difficulty: string,
  manifest: ManifestRound[],
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc('roam_create_solo_run', {
    p_difficulty: difficulty,
    p_total_rounds: manifest.length,
    p_manifest: manifest as unknown as Json,
  });
  if (error) throw new Error(error.message);
  const obj = (data ?? {}) as Record<string, unknown>;
  if (typeof obj.run_id !== 'string') throw new Error('Malformed solo run response.');
  return obj.run_id;
}

export async function submitSoloGuess(
  runId: string,
  roundNumber: number,
  lat: number,
  lng: number,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc('roam_submit_solo_guess', {
    p_run_id: runId,
    p_round_number: roundNumber,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) throw new Error(error.message);
}

export async function finalizeSoloRun(runId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc('roam_finalize_solo_run', { p_run_id: runId });
  if (error) throw new Error(error.message);
}

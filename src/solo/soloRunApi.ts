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
  timerSeconds: number | null = null,
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc('roam_create_solo_run', {
    p_difficulty: difficulty,
    p_total_rounds: manifest.length,
    p_manifest: manifest as unknown as Json,
    p_timer_seconds: timerSeconds,
  });
  if (error) throw new Error(error.message);
  const obj = (data ?? {}) as Record<string, unknown>;
  if (typeof obj.run_id !== 'string') throw new Error('Malformed solo run response.');
  return obj.run_id;
}

export interface ServerGuessResult {
  distanceKm: number;
  score: number;
  lat: number;
  lng: number;
  label: string;
  country: string;
  locationId: string;
}

function parseGuessResult(data: unknown): ServerGuessResult | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const distanceKm = o.distance_km;
  const score = o.score;
  const lat = o.lat;
  const lng = o.lng;
  const label = o.label;
  const country = o.country;
  const locationId = o.location_id;
  if (
    typeof distanceKm !== 'number' ||
    typeof score !== 'number' ||
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    typeof label !== 'string' ||
    typeof country !== 'string' ||
    typeof locationId !== 'string'
  ) {
    return null;
  }
  return { distanceKm, score, lat, lng, label, country, locationId };
}

export async function submitSoloGuess(
  runId: string,
  roundNumber: number,
  lat: number,
  lng: number,
): Promise<ServerGuessResult | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('roam_submit_solo_guess', {
    p_run_id: runId,
    p_round_number: roundNumber,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) throw new Error(error.message);
  return parseGuessResult(data);
}

/** Fetch the caller's active run (if any), for the resume prompt. Returns the raw RPC payload — see solo/resume.ts for parsing/validation. */
export async function fetchActiveSoloRun(): Promise<unknown> {
  const supabase = getSupabase();
  if (!supabase) return { active: false };
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc('roam_get_active_solo_run');
  if (error) throw new Error(error.message);
  return data;
}

export async function finalizeSoloRun(runId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc('roam_finalize_solo_run', { p_run_id: runId });
  if (error) throw new Error(error.message);
}

/** Explicitly abandon an active run (exit flow). Idempotent; never scores. */
export async function abandonSoloRun(runId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc('roam_abandon_solo_run', { p_run_id: runId });
  if (error) throw new Error(error.message);
}

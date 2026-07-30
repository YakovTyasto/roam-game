import { getSupabase } from '../multiplayer/supabaseClient';
import { ensureAnonymousSession } from '../multiplayer/auth';
import { withTimeout } from '../utils/withTimeout';
import type { OfficialRun } from './officialRun';
import { parseOfficialRun } from './officialRun';

/**
 * Supabase calls for server-authoritative official runs (migration 0015).
 *
 * Statically imports the Supabase client, so this module must only ever be
 * reached through a dynamic `import()` — that is what keeps the SDK out of the
 * main bundle for players with no backend configured.
 *
 * Every call here is bounded. An official run is started from a button on the
 * home screen, and a hung request behind that button is exactly the failure that
 * makes an app feel broken, so nothing waits forever: the caller gets a timeout
 * it can fall back from (see src/solo/useSoloRun.ts, which drops to a
 * clearly-labelled local game).
 */

/** Bound on starting a run: the player is staring at a spinner for this long. */
export const START_RUN_TIMEOUT_MS = 12_000;
/** Bound on a guess submission. Longer: losing this loses the round's score. */
export const SUBMIT_TIMEOUT_MS = 15_000;
/** Bound on the resume probe, which must never gate the home screen. */
export const RESUME_TIMEOUT_MS = 8_000;

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Online play is not configured.');
  return supabase;
}

/** Start an official solo run whose rounds are chosen by the server. */
export async function startOfficialRun(
  difficulty: string,
  totalRounds: number,
  timerSeconds: number | null,
): Promise<OfficialRun> {
  const supabase = client();
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_start_official_run_v2', {
      p_difficulty: difficulty,
      p_total_rounds: totalRounds,
      p_timer_seconds: timerSeconds,
    }),
    START_RUN_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  const run = parseOfficialRun(data);
  if (!run) throw new Error('The server did not return a playable run.');
  return run;
}

/**
 * Fetch the caller's active official run (or a specific one by id). Returns null
 * for "nothing to resume", which is the normal cold-start answer.
 */
export async function fetchOfficialRun(runId?: string): Promise<OfficialRun | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_get_official_run_v2', { p_run_id: runId ?? null }),
    RESUME_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return parseOfficialRun(data);
}

export interface OfficialGuessResult {
  score: number;
  distanceKm: number;
  locationId: string;
  lat: number;
  lng: number;
  label: string;
  country: string;
  /** True when this round was already scored — the stored result is returned. */
  already: boolean;
  /** True when the server deadline had passed, so the guess scored zero. */
  expired: boolean;
}

function parseGuess(data: unknown): OfficialGuessResult | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const nums = ['score', 'distance_km', 'lat', 'lng'] as const;
  if (nums.some((k) => typeof o[k] !== 'number' || !Number.isFinite(o[k] as number))) return null;
  if (typeof o.location_id !== 'string') return null;
  return {
    score: o.score as number,
    distanceKm: o.distance_km as number,
    lat: o.lat as number,
    lng: o.lng as number,
    label: typeof o.label === 'string' ? o.label : '',
    country: typeof o.country === 'string' ? o.country : '',
    locationId: o.location_id,
    already: o.already === true,
    expired: o.expired === true,
  };
}

/**
 * Submit one guess. The server scores it and reveals that round's answer — the
 * only way the client learns it. Safe to retry: the RPC is idempotent and a
 * repeat returns the stored score rather than re-scoring.
 */
export async function submitOfficialGuess(
  runId: string,
  roundNumber: number,
  lat: number,
  lng: number,
): Promise<OfficialGuessResult> {
  const supabase = client();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_submit_official_guess_v2', {
      p_run_id: runId,
      p_round_number: roundNumber,
      p_lat: lat,
      p_lng: lng,
    }),
    SUBMIT_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  const parsed = parseGuess(data);
  if (!parsed) throw new Error('The server did not return a score for this round.');
  return parsed;
}

export interface OfficialFinalizeResult {
  totalScore: number;
  maxScore: number;
  totalDistanceKm: number;
  eligible: boolean;
  already: boolean;
}

/** Finalize a run. Idempotent server-side; safe to call after a retry. */
export async function finalizeOfficialRun(runId: string): Promise<OfficialFinalizeResult | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await withTimeout(
    supabase.rpc('roam_finalize_official_run_v2', { p_run_id: runId }),
    SUBMIT_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    totalScore: typeof o.total_score === 'number' ? o.total_score : 0,
    maxScore: typeof o.max_score === 'number' ? o.max_score : 0,
    totalDistanceKm: typeof o.total_distance_km === 'number' ? o.total_distance_km : 0,
    eligible: o.eligible === true,
    already: o.already === true,
  };
}

/**
 * Non-secret catalog totals (counts only — no location, no coordinate). Used as
 * the denominators on the statistics screen ("12 of 79 countries").
 */
export interface CatalogSummary {
  total: number;
  easy: number;
  normal: number;
  hard: number;
  countries: number;
  continents: number;
}

export async function fetchCatalogSummary(): Promise<CatalogSummary | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousSession();
  const { data, error } = await withTimeout(
    supabase.rpc('roam_catalog_summary'),
    RESUME_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  const o = (data ?? {}) as Record<string, unknown>;
  const int = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : 0);
  return {
    total: int('total'),
    easy: int('easy'),
    normal: int('normal'),
    hard: int('hard'),
    countries: int('countries'),
    continents: int('continents'),
  };
}

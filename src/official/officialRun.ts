import type { PanoramaTarget, RoundResult } from '../types';
import type { Difficulty } from '../config/difficulty';
import { toDifficulty } from '../config/difficulty';

/**
 * Pure parsing/validation for the server-authoritative run payload
 * (`roam_run_payload` in migration 0015). Kept free of Supabase imports so the
 * whole contract is unit-testable, and so a malformed or hostile payload is
 * rejected in one reviewable place rather than crashing a screen.
 *
 * The shape is deliberately asymmetric, and that asymmetry IS the security
 * model: an un-guessed round carries only what is needed to render a panorama
 * (pano id + orientation + server deadline). Its `lat`/`lng`/`label`/`country`/
 * `location_id` are absent, so there is nothing here for a modified client to
 * read ahead. A completed round carries its answer and the player's guess,
 * because the player has already earned it.
 *
 * See docs/ENGAGEMENT_CORE_V5.md for the one thing this cannot hide: the active
 * panorama id must reach the browser to be rendered.
 */

/** A round whose answer the client has NOT been told. Rendered by pano id. */
export interface HiddenPanorama extends PanoramaTarget {
  /**
   * Synthetic client-side key for this round. Never the catalog id — the server
   * withholds that until the round completes, precisely so a collected set of
   * ids cannot be correlated against the bundled offline catalog.
   */
  locationId: string;
}

export type OfficialRunMode = 'solo' | 'daily' | 'challenge' | 'practice';

export interface OfficialRunRound {
  roundNumber: number;
  status: 'pending' | 'active' | 'complete';
  panorama: PanoramaTarget | null;
  /** Server-owned deadline for this round, or null when it hasn't started. */
  expiresAt: Date | null;
  /** Present only once the round is complete. */
  result: RoundResult | null;
}

export interface OfficialRun {
  runId: string;
  mode: OfficialRunMode;
  difficulty: Difficulty;
  roundCount: number;
  timerSeconds: number;
  currentRound: number;
  totalScore: number;
  status: 'active' | 'complete' | 'abandoned';
  serverSelected: boolean;
  serverNow: Date;
  rounds: OfficialRunRound[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function runStatus(value: unknown): OfficialRun['status'] {
  return value === 'complete' || value === 'abandoned' ? value : 'active';
}

function roundStatus(value: unknown): OfficialRunRound['status'] {
  return value === 'complete' || value === 'active' ? value : 'pending';
}

function mode(value: unknown): OfficialRunMode {
  return value === 'daily' || value === 'challenge' || value === 'practice' ? value : 'solo';
}

/**
 * Parse a run payload. Returns `null` for anything that isn't a usable run —
 * including `{ found: false }`, which is the normal "no active run" answer and
 * must never be treated as an error.
 */
export function parseOfficialRun(data: unknown): OfficialRun | null {
  const obj = asRecord(data);
  if (!obj || obj.found !== true) return null;

  const runId = str(obj.run_id);
  const roundCount = num(obj.total_rounds);
  if (!runId || roundCount === null || roundCount < 1) return null;

  const rawRounds = Array.isArray(obj.rounds) ? obj.rounds : [];
  const rounds: OfficialRunRound[] = [];
  const difficulty = toDifficulty(obj.difficulty);

  for (const raw of rawRounds) {
    const r = asRecord(raw);
    if (!r) continue;
    const roundNumber = num(r.round_number);
    if (roundNumber === null) continue;
    const status = roundStatus(r.status);

    const panoId = str(r.pano_id);
    const panorama: PanoramaTarget | null = panoId
      ? {
          panoId,
          heading: num(r.heading) ?? 0,
          pitch: num(r.pitch) ?? 0,
          zoom: num(r.zoom) ?? 0,
        }
      : null;

    // A result exists only when the server revealed the answer AND recorded a
    // guess. Both halves are required: a revealed answer with no guess would be
    // a server bug, and treating it as a result would show a phantom round.
    const lat = num(r.lat);
    const lng = num(r.lng);
    const guessLat = num(r.guess_lat);
    const guessLng = num(r.guess_lng);
    const score = num(r.score);
    const distanceKm = num(r.distance_km);
    const result: RoundResult | null =
      status === 'complete' &&
      lat !== null &&
      lng !== null &&
      guessLat !== null &&
      guessLng !== null &&
      score !== null &&
      distanceKm !== null
        ? {
            location: {
              id: str(r.location_id) ?? `round-${roundNumber}`,
              lat,
              lng,
              label: str(r.label) ?? '',
              country: str(r.country) ?? '',
              difficulty,
            },
            guess: { lat: guessLat, lng: guessLng },
            distanceKm,
            score,
          }
        : null;

    rounds.push({
      roundNumber,
      status,
      panorama,
      expiresAt: date(r.expires_at),
      result,
    });
  }

  rounds.sort((a, b) => a.roundNumber - b.roundNumber);

  return {
    runId,
    mode: mode(obj.mode),
    difficulty,
    roundCount,
    timerSeconds: num(obj.round_duration_seconds) ?? 120,
    currentRound: num(obj.current_round) ?? 1,
    totalScore: num(obj.total_score) ?? 0,
    status: runStatus(obj.status),
    serverSelected: obj.server_selected === true,
    serverNow: date(obj.server_now) ?? new Date(),
    rounds,
  };
}

/**
 * The hidden panorama for each not-yet-completed round, keyed by 0-based round
 * index — exactly the shape the game state machine stores. A completed round
 * has no entry: its answer is known, so it renders like any local round.
 */
export function hiddenPanoramasOf(run: OfficialRun): Record<number, HiddenPanorama> {
  const map: Record<number, HiddenPanorama> = {};
  for (const round of run.rounds) {
    if (round.status === 'complete' || !round.panorama) continue;
    map[round.roundNumber - 1] = {
      ...round.panorama,
      locationId: `${run.runId}:${round.roundNumber}`,
    };
  }
  return map;
}

/** Completed results in round order — what the game state machine replays. */
export function resultsOf(run: OfficialRun): RoundResult[] {
  return run.rounds
    .filter((r): r is OfficialRunRound & { result: RoundResult } => r.result !== null)
    .map((r) => r.result);
}

/**
 * 0-based index of the round to play next.
 *
 * Derived from the rounds themselves rather than trusting `current_round`: the
 * two agree in practice, but the round statuses are what the submit RPC
 * enforces, so deriving from them cannot desynchronise the UI from the server.
 */
export function nextRoundIndex(run: OfficialRun): number {
  const firstUnplayed = run.rounds.find((r) => r.status !== 'complete');
  return firstUnplayed ? firstUnplayed.roundNumber - 1 : run.rounds.length;
}

/** True when every round is scored and only finalization is left. */
export function awaitingFinalize(run: OfficialRun): boolean {
  return (
    run.status === 'active' &&
    run.rounds.length >= run.roundCount &&
    run.rounds.every((r) => r.status === 'complete')
  );
}

/**
 * Seconds remaining on the current round according to the SERVER's clock.
 *
 * Uses the server's own `server_now` as the reference rather than the device
 * clock, so a wrong or deliberately-skewed local clock cannot extend a round.
 * Returns null when the round has no deadline (No Timer).
 */
export function remainingSeconds(run: OfficialRun, roundIndex: number): number | null {
  const round = run.rounds[roundIndex];
  if (!round?.expiresAt) return null;
  const seconds = Math.floor((round.expiresAt.getTime() - run.serverNow.getTime()) / 1000);
  return Math.max(0, seconds);
}

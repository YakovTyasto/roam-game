import type { GameLocation, PanoramaTarget, RoundResult } from '../types';
import type { Difficulty } from '../config/difficulty';
import { isDifficulty } from '../config/difficulty';

/** One round as returned by roam_get_active_solo_run (see migration 0009). */
export interface ActiveSoloRunRound {
  roundNumber: number;
  locationId: string;
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
  status: 'pending' | 'active' | 'complete';
  /** Server timestamp the round became active, or null if not yet started. */
  startedAt: string | null;
  /** Revealed only once status === 'complete'. */
  label: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  guessLat: number | null;
  guessLng: number | null;
  distanceKm: number | null;
  score: number | null;
}

export interface ActiveSoloRun {
  runId: string;
  difficulty: Difficulty;
  totalRounds: number;
  roundDurationSeconds: number;
  /** 1-based. */
  currentRound: number;
  totalScore: number;
  serverNow: string;
  rounds: ActiveSoloRunRound[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseRound(raw: unknown): ActiveSoloRunRound | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const roundNumber = num(o.round_number);
  const locationId = str(o.location_id);
  const panoId = str(o.pano_id);
  const status = o.status;
  if (roundNumber === null || !locationId || !panoId) return null;
  if (status !== 'pending' && status !== 'active' && status !== 'complete') return null;

  return {
    roundNumber,
    locationId,
    panoId,
    heading: num(o.heading) ?? 0,
    pitch: num(o.pitch) ?? 0,
    zoom: num(o.zoom) ?? 0,
    status,
    startedAt: str(o.started_at),
    label: str(o.label),
    country: str(o.country),
    lat: num(o.lat),
    lng: num(o.lng),
    guessLat: num(o.guess_lat),
    guessLng: num(o.guess_lng),
    distanceKm: num(o.distance_km),
    score: num(o.score),
  };
}

/**
 * Defensively parse roam_get_active_solo_run's response. Returns null for
 * `{active: false}`, a malformed/incompatible payload, or anything that
 * doesn't survive shape validation — callers must treat null as "nothing to
 * resume" and fail safe rather than crash the app on a stale/bad response.
 */
export function parseActiveSoloRun(data: unknown): ActiveSoloRun | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.active !== true) return null;

  const runId = str(o.run_id);
  const difficulty = o.difficulty;
  const totalRounds = num(o.total_rounds);
  const roundDurationSeconds = num(o.round_duration_seconds);
  const currentRound = num(o.current_round);
  const totalScore = num(o.total_score);
  const serverNow = str(o.server_now);
  if (
    !runId ||
    !isDifficulty(difficulty) ||
    totalRounds === null ||
    roundDurationSeconds === null ||
    currentRound === null ||
    totalScore === null ||
    !serverNow ||
    !Array.isArray(o.rounds)
  ) {
    return null;
  }

  const rounds = o.rounds.map(parseRound);
  if (rounds.some((r) => r === null)) return null;

  return {
    runId,
    difficulty,
    totalRounds,
    roundDurationSeconds,
    currentRound,
    totalScore,
    serverNow,
    rounds: rounds as ActiveSoloRunRound[],
  };
}

/**
 * Seconds left in a round, using the server's own clock on both ends so a
 * skewed or paused local clock can never make an expired round look active.
 * Never negative — a round whose time is already up resumes at 0, not with
 * a fabricated grace period.
 */
export function computeRemainingSeconds(
  startedAt: string | null,
  roundDurationSeconds: number,
  serverNow: string,
): number {
  if (!startedAt) return roundDurationSeconds;
  const elapsedMs = Date.parse(serverNow) - Date.parse(startedAt);
  if (!Number.isFinite(elapsedMs)) return roundDurationSeconds;
  const remaining = roundDurationSeconds - Math.floor(elapsedMs / 1000);
  return Math.max(0, remaining);
}

export interface SoloResumeData {
  runId: string;
  difficulty: Difficulty;
  roundCount: number;
  timerSeconds: number;
  /** 0-based. */
  roundIndex: number;
  remainingSeconds: number;
  /** Reconstructed from every round already marked 'complete'. */
  results: RoundResult[];
  /** The still-unguessed round's panorama, or null once every round is done. */
  currentPanorama: (PanoramaTarget & { locationId: string }) | null;
  /** Every round was guessed but the run hasn't been finalized yet. */
  awaitingFinalize: boolean;
}

/** Build a placeholder GameLocation for a round already revealed by the server. */
function completedLocation(r: ActiveSoloRunRound, difficulty: Difficulty): GameLocation {
  return {
    id: r.locationId,
    lat: r.lat ?? 0,
    lng: r.lng ?? 0,
    label: r.label ?? 'Unknown',
    country: r.country ?? 'Unknown',
    difficulty,
  };
}

/**
 * Turn a validated ActiveSoloRun into everything the UI needs to resume:
 * completed rounds become real RoundResults (the server already revealed
 * their answers); the current round is resumed by pano id only — never by
 * lat/lng, which stays hidden until guessed, exactly like a fresh round.
 */
export function buildResumeData(run: ActiveSoloRun): SoloResumeData {
  const sorted = [...run.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const results: RoundResult[] = [];
  let currentPanorama: SoloResumeData['currentPanorama'] = null;

  for (const r of sorted) {
    if (r.status === 'complete') {
      results.push({
        location: completedLocation(r, run.difficulty),
        guess: { lat: r.guessLat ?? 0, lng: r.guessLng ?? 0 },
        distanceKm: r.distanceKm ?? 0,
        score: r.score ?? 0,
      });
    } else if (r.roundNumber === run.currentRound) {
      currentPanorama = {
        locationId: r.locationId,
        panoId: r.panoId,
        heading: r.heading,
        pitch: r.pitch,
        zoom: r.zoom,
      };
    }
  }

  const remainingSeconds = currentPanorama
    ? computeRemainingSeconds(
        sorted.find((r) => r.roundNumber === run.currentRound)?.startedAt ?? null,
        run.roundDurationSeconds,
        run.serverNow,
      )
    : 0;

  return {
    runId: run.runId,
    difficulty: run.difficulty,
    roundCount: run.totalRounds,
    timerSeconds: run.roundDurationSeconds,
    roundIndex: Math.min(run.currentRound - 1, run.totalRounds - 1),
    remainingSeconds,
    results,
    currentPanorama,
    awaitingFinalize: currentPanorama === null && results.length === run.totalRounds,
  };
}

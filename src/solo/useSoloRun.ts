import { useCallback, useRef } from 'react';
import type { GameLocation, LatLng } from '../types';
import type { GameConfig } from '../config/gameConfig';
import { hasGoogleMapsKey, hasSupabaseConfig } from '../config/env';
import { locationProvider } from '../providers/LocationProvider';
import type { OfficialRun } from '../official/officialRun';
import type { OfficialGuessResult } from '../official/officialRunApi';

/**
 * How a solo game is being played, and therefore whether its score counts.
 *
 *   • `official` — the server chose the locations, holds the answers and scores
 *     every guess. This is the only kind of game that reaches a leaderboard.
 *   • `local` — the bundled catalog chose the locations and the client scores
 *     them. Endless, and the fallback when the backend is unreachable or not
 *     configured. Fully playable; never submitted anywhere; never presented as
 *     an official result.
 *
 * Keeping this an explicit, visible value (rather than "did runId end up set?")
 * is deliberate: the UI has to be able to *say* which one the player got, and a
 * silent downgrade from official to local is exactly the kind of thing that
 * quietly invalidates a leaderboard.
 */
export type SoloRunKind = 'official' | 'local';

export type SoloBeginResult =
  | { kind: 'official'; run: OfficialRun }
  | {
      kind: 'local';
      locations: GameLocation[];
      backups: GameLocation[];
      /** Set when an official run was wanted but could not be started. */
      degradedReason?: 'offline' | 'unavailable';
    };

export interface SoloRunController {
  /**
   * Begin a solo game for `config`.
   *
   * Prefers an official server-selected run for fixed-length games when the
   * backend is configured; falls back to a local, non-official game on any
   * failure (including a timeout — see officialRunApi's bounds). Endless is
   * always local: it has no fixed length, so there is nothing to rank.
   */
  begin: (config: GameConfig) => Promise<SoloBeginResult>;
  /**
   * Adopt an already-running official run (resume). Subsequent guesses and the
   * finalize call target it.
   */
  adopt: (run: OfficialRun, roundsAlreadyComplete: number) => void;
  /**
   * Submit a guess for `roundIndex`. For an official run this is the ONLY source
   * of the round's score and answer; resolves null for a local game, where the
   * client already knows the answer and scores it itself.
   */
  recordGuess: (roundIndex: number, guess: LatLng) => Promise<OfficialGuessResult | null>;
  /** Finalize the official run once every round is in. No-op for a local game. */
  finalize: () => Promise<void>;
  /** Abandon the official run without scoring it. Idempotent. */
  abandon: () => Promise<void>;
  /** Whether the current game is an official, server-scored run. */
  isOfficial: () => boolean;
  /** The active official run id, or null. */
  runId: () => string | null;
}

/**
 * Orchestrates the official run alongside the local game loop.
 *
 * The client never computes a score for an official round — it does not have the
 * answer to compute one from. That is the whole point of V5: pre-V5 the client
 * built the manifest (answers included) and the server merely re-scored what the
 * client already knew.
 */
export function useSoloRun(): SoloRunController {
  const runIdRef = useRef<string | null>(null);
  const totalRoundsRef = useRef(0);
  const submittedRef = useRef(0);

  const begin = useCallback(async (config: GameConfig): Promise<SoloBeginResult> => {
    runIdRef.current = null;
    totalRoundsRef.current = 0;
    submittedRef.current = 0;

    const { difficulty, roundCount } = config;

    // Endless has no fixed total, so it is always a local session.
    if (roundCount === null) {
      const { locations, backups } = await locationProvider.getGameLocations(1, difficulty);
      return { kind: 'local', locations, backups };
    }

    if (hasSupabaseConfig() && hasGoogleMapsKey()) {
      try {
        const { startOfficialRun } = await import('../official/officialRunApi');
        const run = await startOfficialRun(difficulty, roundCount, config.timerSeconds);
        runIdRef.current = run.runId;
        totalRoundsRef.current = run.roundCount;
        return { kind: 'official', run };
      } catch {
        // Bounded failure (offline, cold backend, timeout, catalog exhausted).
        // The game still starts — as an explicitly local one.
        const { locations, backups } = await locationProvider.getGameLocations(
          roundCount,
          difficulty,
        );
        return { kind: 'local', locations, backups, degradedReason: 'unavailable' };
      }
    }

    const { locations, backups } = await locationProvider.getGameLocations(roundCount, difficulty);
    return {
      kind: 'local',
      locations,
      backups,
      // Not a degradation when there is no backend configured at all — that is
      // simply how this deployment works.
      degradedReason: hasSupabaseConfig() ? 'offline' : undefined,
    };
  }, []);

  const adopt = useCallback((run: OfficialRun, roundsAlreadyComplete: number) => {
    runIdRef.current = run.runId;
    totalRoundsRef.current = run.roundCount;
    submittedRef.current = roundsAlreadyComplete;
  }, []);

  const recordGuess = useCallback(async (roundIndex: number, guess: LatLng) => {
    const runId = runIdRef.current;
    if (!runId) return null;
    const { submitOfficialGuess } = await import('../official/officialRunApi');
    const result = await submitOfficialGuess(runId, roundIndex + 1, guess.lat, guess.lng);
    submittedRef.current = Math.max(submittedRef.current, roundIndex + 1);
    return result;
  }, []);

  const finalize = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    // Only finalize once every round reached the server; finalizing early would
    // be rejected anyway, and swallowing that error would hide a real problem.
    if (submittedRef.current < totalRoundsRef.current) return;
    try {
      const { finalizeOfficialRun } = await import('../official/officialRunApi');
      await finalizeOfficialRun(runId);
    } catch {
      /* the run stays finalizable; local play is unaffected */
    } finally {
      runIdRef.current = null;
    }
  }, []);

  const abandon = useCallback(async () => {
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (!runId) return;
    try {
      const { abandonSoloRun } = await import('./soloRunApi');
      await abandonSoloRun(runId);
    } catch {
      /* best-effort — the 12h run expiry is the fallback */
    }
  }, []);

  const isOfficial = useCallback(() => runIdRef.current !== null, []);
  const runId = useCallback(() => runIdRef.current, []);

  return { begin, adopt, recordGuess, finalize, abandon, isOfficial, runId };
}

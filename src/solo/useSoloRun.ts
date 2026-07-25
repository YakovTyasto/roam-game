import { useCallback, useRef } from 'react';
import type { GameLocation, LatLng } from '../types';
import type { Difficulty } from '../config/difficulty';
import type { GameConfig } from '../config/gameConfig';
import { hasGoogleMapsKey, hasSupabaseConfig } from '../config/env';
import { locationProvider } from '../providers/LocationProvider';
import { buildDifficultyPool } from '../utils/difficultyPool';
import { ensureGoogleMaps } from '../hooks/useGoogleMaps';
import { buildManifest } from '../multiplayer/manifest';
import type { ManifestRound } from '../multiplayer/types';

export interface SoloRunController {
  /**
   * Begin a solo game for `config`. When Supabase + Maps are available AND
   * the game is fixed-length (not Endless), this also starts a
   * server-tracked run (for the leaderboard and resume); otherwise — or for
   * Endless, which is always local-only in this phase — it falls back to a
   * purely local game. Always returns locations to play locally; Endless
   * only returns the first round (see utils/endlessSelection.ts for how
   * subsequent rounds are generated one at a time).
   */
  begin: (
    config: GameConfig,
  ) => Promise<{ locations: GameLocation[]; backups: GameLocation[] }>;
  /** Record a guess against the active server run (no-op locally). */
  recordGuess: (roundIndex: number, guess: LatLng) => void;
  /** Finalize the server run once all rounds are in (no-op locally). */
  finalize: () => Promise<void>;
  /** Whether the current game is being recorded to the leaderboard. */
  isServerTracked: () => boolean;
}

function manifestToLocations(manifest: ManifestRound[]): GameLocation[] {
  return manifest.map((m) => ({
    id: m.location_id,
    lat: m.lat,
    lng: m.lng,
    label: m.label,
    country: m.country,
    // The manifest is difficulty-scoped, but the tier isn't round-critical here.
    difficulty: 'normal' as Difficulty,
  }));
}

/**
 * Orchestrates the optional server-authoritative solo run alongside the local
 * game. Guesses are scored locally for instant feedback AND on the server (the
 * authority for the leaderboard). The client can never submit a fabricated
 * total — it only submits coordinates, one per round.
 */
export function useSoloRun(): SoloRunController {
  const runIdRef = useRef<string | null>(null);
  const roundsRef = useRef(0);
  const submittedRef = useRef(0);

  const begin = useCallback(async (config: GameConfig) => {
    runIdRef.current = null;
    roundsRef.current = 0;
    submittedRef.current = 0;

    const { difficulty, roundCount, timerSeconds } = config;

    // Endless has no fixed total_rounds and is always local-only/unranked in
    // this phase — only the first round is needed up front.
    if (roundCount === null) {
      const { locations, backups } = await locationProvider.getGameLocations(1, difficulty);
      return { locations, backups };
    }

    // Try the server-tracked path first when everything is configured. Any
    // round count (including a non-5 custom count) can be server-tracked —
    // the server itself decides leaderboard eligibility (exactly 5 rounds).
    if (hasSupabaseConfig() && hasGoogleMapsKey()) {
      try {
        const google = await ensureGoogleMaps();
        const all = await locationProvider.getAll();
        const { locations: pool } = buildDifficultyPool(all, difficulty, roundCount);
        const manifest = await buildManifest(google, pool, roundCount);
        const { createSoloRun } = await import('./soloRunApi');
        runIdRef.current = await createSoloRun(difficulty, manifest, timerSeconds);
        roundsRef.current = roundCount;
        return { locations: manifestToLocations(manifest), backups: [] };
      } catch {
        // Fall through to the local-only game; leaderboard simply won't record.
        runIdRef.current = null;
      }
    }

    const { locations, backups } = await locationProvider.getGameLocations(
      roundCount,
      difficulty,
    );
    return { locations, backups };
  }, []);

  const recordGuess = useCallback((roundIndex: number, guess: LatLng) => {
    const runId = runIdRef.current;
    if (!runId) return;
    submittedRef.current = Math.max(submittedRef.current, roundIndex + 1);
    void (async () => {
      try {
        const { submitSoloGuess } = await import('./soloRunApi');
        await submitSoloGuess(runId, roundIndex + 1, guess.lat, guess.lng);
      } catch {
        // A dropped guess submission means the run can't be finalized cleanly;
        // that game just won't reach the leaderboard. Solo play is unaffected.
      }
    })();
  }, []);

  const finalize = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    // Only finalize when every round was submitted to the server.
    if (submittedRef.current < roundsRef.current) return;
    try {
      const { finalizeSoloRun } = await import('./soloRunApi');
      await finalizeSoloRun(runId);
    } catch {
      /* leaderboard write failed; not fatal for local play */
    } finally {
      runIdRef.current = null;
    }
  }, []);

  const isServerTracked = useCallback(() => runIdRef.current !== null, []);

  return { begin, recordGuess, finalize, isServerTracked };
}

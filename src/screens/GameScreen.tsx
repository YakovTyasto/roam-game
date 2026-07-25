import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { LatLng, Preferences } from '../types';
import type { GameAction, GameState } from '../game/state';
import { currentLocation } from '../game/state';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY, difficultyLabel } from '../config/difficulty';
import type { Locale } from '../i18n/locale';
import { haversineDistanceKm } from '../utils/distance';
import { calculateScore } from '../utils/score';
import { useIsDesktop, useIsTablet } from '../hooks/useMediaQuery';
import type { ServerGuessResult } from '../solo/soloRunApi';
import { StreetView } from '../components/street/StreetView';
import { HUD } from '../components/hud/HUD';
import { MapPanel, type Device } from '../components/map/MapPanel';
import { LoadingOverlay } from '../components/ui/LoadingOverlay';
import { ExitConfirmDialog } from '../components/ui/ExitConfirmDialog';
import { useExitGuard } from '../hooks/useExitGuard';

interface GameScreenProps {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  preferences: Preferences;
  /** Active difficulty (drives the round timer + HUD label). */
  difficulty?: Difficulty;
  /**
   * Called after each guess is submitted, so a server-authoritative solo run
   * can record it. `roundIndex` is 0-based; guess is the placed coordinate.
   * A resumed round (state.resumePanorama set) has no locally-known answer,
   * so it awaits this and trusts the server's score/distance instead of
   * computing them locally.
   */
  onGuessSubmitted?: (roundIndex: number, guess: LatLng) => Promise<ServerGuessResult | null>;
  onOpenSettings: () => void;
  /** Exit flow: persist resumable state (fixed games only), then leave. */
  onSaveAndExit: () => void;
  /** Exit flow: discard the run without saving, then leave. */
  onAbandon: () => void;
  /**
   * Resume only: seconds actually left in the resumed round, computed from
   * server time (see solo/resume.ts). Used once, only while
   * state.resumePanorama is set for the current round.
   */
  resumeRemainingSeconds?: number;
  locale?: Locale;
}

export function GameScreen({
  state,
  dispatch,
  preferences,
  difficulty = DEFAULT_DIFFICULTY,
  onGuessSubmitted,
  onOpenSettings,
  onSaveAndExit,
  onAbandon,
  resumeRemainingSeconds,
  locale,
}: GameScreenProps) {
  // null means the configured game has No Timer — the round-timer feature is
  // entirely inactive regardless of the "show timer" display preference.
  const ROUND_SECONDS = state.timerSeconds;
  const isEndless = state.roundCount === null;
  const isDesktop = useIsDesktop();
  const isTablet = useIsTablet();
  const device: Device = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone';

  const location = currentLocation(state);
  const isResult = state.status === 'roundResult';
  const isLoading = state.status === 'loadingRound';

  // On desktop the floating card is always visible; treat it as "expanded"
  // only when the user enlarges it. On mobile/tablet the sheet is closed until
  // opened.
  const [mapExpanded, setMapExpanded] = useState(false);

  const openMap = useCallback(() => {
    setMapExpanded(true);
    dispatch({ type: 'OPEN_MAP' });
  }, [dispatch]);

  const closeMap = useCallback(() => {
    setMapExpanded(false);
    dispatch({ type: 'CLOSE_MAP' });
  }, [dispatch]);

  // Collapse the map at the start of every new round.
  useEffect(() => {
    if (state.status === 'exploring') setMapExpanded(false);
  }, [state.status, state.roundIndex]);

  const handlePlaceGuess = useCallback(
    (latlng: LatLng) => dispatch({ type: 'PLACE_GUESS', guess: latlng }),
    [dispatch],
  );

  const submitGuess = useCallback(
    (guess: LatLng | null) => {
      const loc = currentLocation(state);
      if (!loc) return;
      const effectiveGuess = guess ?? { lat: 0, lng: 0 };

      if (state.resumePanorama) {
        // A resumed, not-yet-guessed round: the answer was never sent to
        // this client, so the server's response is the only source of truth
        // for scoring — there is nothing correct to compute locally.
        void (async () => {
          const server = await onGuessSubmitted?.(state.roundIndex, effectiveGuess);
          if (!server) {
            dispatch({
              type: 'SET_ERROR',
              message: 'Could not score this round — please check your connection and try again.',
            });
            return;
          }
          dispatch({
            type: 'SUBMIT_GUESS',
            result: {
              location: { id: server.locationId, lat: server.lat, lng: server.lng, label: server.label, country: server.country, difficulty },
              guess: effectiveGuess,
              distanceKm: server.distanceKm,
              score: server.score,
            },
          });
        })();
        return;
      }

      const distanceKm = haversineDistanceKm(effectiveGuess, {
        lat: loc.lat,
        lng: loc.lng,
      });
      const score = guess ? calculateScore(distanceKm) : 0;
      dispatch({
        type: 'SUBMIT_GUESS',
        result: { location: loc, guess: effectiveGuess, distanceKm, score },
      });
      // Mirror the guess to the server-authoritative solo run (if any). The
      // server re-scores it from the same coordinates; the client score is only
      // for display, fire-and-forget here since it doesn't block the UI.
      void onGuessSubmitted?.(state.roundIndex, effectiveGuess);
    },
    [dispatch, state, onGuessSubmitted, difficulty],
  );

  const handleConfirm = useCallback(() => {
    if (!state.guess) return;
    submitGuess(state.guess);
  }, [state.guess, submitGuess]);

  const handleNext = useCallback(() => {
    dispatch({ type: 'NEXT_ROUND' });
  }, [dispatch]);

  // ── Street View callbacks (stable) ──────────────────────
  const handleReady = useCallback(() => {
    dispatch({ type: 'ROUND_READY' });
  }, [dispatch]);

  const handleNoPanorama = useCallback(() => {
    dispatch({ type: 'REPLACE_CURRENT_LOCATION' });
  }, [dispatch]);

  const handleLoadError = useCallback(
    (message: string) => dispatch({ type: 'SET_ERROR', message }),
    [dispatch],
  );

  // ── Optional per-round timer (state.timerSeconds === null → No Timer) ──
  const [secondsLeft, setSecondsLeft] = useState<number>(ROUND_SECONDS ?? 0);
  const submitRef = useRef(submitGuess);
  submitRef.current = submitGuess;
  const guessRef = useRef(state.guess);
  guessRef.current = state.guess;

  // Reset the timer whenever a fresh round begins exploring. A resumed round
  // starts from its actual server-computed remaining time, not a fresh full
  // duration — never restoring an expired timer as if time remains.
  useEffect(() => {
    if (state.status !== 'exploring' || ROUND_SECONDS === null) return;
    setSecondsLeft(
      state.resumePanorama && resumeRemainingSeconds !== undefined
        ? resumeRemainingSeconds
        : ROUND_SECONDS,
    );
  }, [state.roundIndex, state.status, ROUND_SECONDS, state.resumePanorama, resumeRemainingSeconds]);

  const timerActive =
    ROUND_SECONDS !== null &&
    preferences.timer &&
    (state.status === 'exploring' || state.status === 'selectingGuess');

  useEffect(() => {
    if (!timerActive) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          // Time's up — auto-submit the current guess (or a zero-score miss).
          submitRef.current(guessRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerActive, state.roundIndex]);

  const totalScore = useMemo(
    () => state.results.reduce((sum, r) => sum + r.score, 0),
    [state.results],
  );

  const lastResult = isResult
    ? state.results[state.results.length - 1]
    : undefined;

  // ── Always-available exit flow ──────────────────────────
  const [exitOpen, setExitOpen] = useState(false);
  const hasUnsavedProgress =
    state.status === 'exploring' || state.status === 'selectingGuess' || state.status === 'roundResult';
  useExitGuard(hasUnsavedProgress, () => setExitOpen(true));

  return (
    <div className="noselect" style={{ position: 'absolute', inset: 0 }}>
      <StreetView
        location={location}
        panorama={state.resumePanorama ?? undefined}
        onReady={handleReady}
        onNoPanorama={handleNoPanorama}
        onLoadError={handleLoadError}
      />

      <HUD
        round={state.roundIndex + 1}
        totalRounds={state.roundCount}
        score={totalScore}
        showTimer={preferences.timer && ROUND_SECONDS !== null}
        secondsLeft={ROUND_SECONDS !== null && preferences.timer ? secondsLeft : null}
        difficultyLabel={difficultyLabel(difficulty)}
        onOpenSettings={onOpenSettings}
        onFinishEndless={isEndless ? () => dispatch({ type: 'FINISH_ENDLESS' }) : undefined}
        onExit={() => setExitOpen(true)}
      />

      <MapPanel
        device={device}
        mode={isResult ? 'result' : 'guess'}
        expanded={mapExpanded}
        onOpen={openMap}
        onClose={closeMap}
        guess={state.guess}
        actual={isResult ? location : null}
        onPlaceGuess={handlePlaceGuess}
        onConfirm={handleConfirm}
        onNext={handleNext}
        isLastRound={state.roundCount !== null && state.roundIndex + 1 >= state.roundCount}
        distanceKm={lastResult?.distanceKm ?? null}
        score={lastResult?.score ?? null}
        units={preferences.units}
      />

      {isLoading && <LoadingOverlay />}

      <ExitConfirmDialog
        open={exitOpen}
        variant={isEndless ? 'endless' : 'solo'}
        locale={locale}
        onContinue={() => setExitOpen(false)}
        onSaveAndExit={
          isEndless
            ? undefined
            : () => {
                setExitOpen(false);
                onSaveAndExit();
              }
        }
        onFinishAndSummary={
          isEndless
            ? () => {
                setExitOpen(false);
                dispatch({ type: 'FINISH_ENDLESS' });
              }
            : undefined
        }
        onAbandon={() => {
          setExitOpen(false);
          onAbandon();
        }}
      />
    </div>
  );
}

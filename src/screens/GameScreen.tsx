import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { LatLng, Preferences } from '../types';
import type { GameAction, GameState } from '../game/state';
import { currentLocation } from '../game/state';
import { APP } from '../config/app';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY, difficultyLabel, difficultyRoundSeconds } from '../config/difficulty';
import { haversineDistanceKm } from '../utils/distance';
import { calculateScore } from '../utils/score';
import { useIsDesktop, useIsTablet } from '../hooks/useMediaQuery';
import { StreetView } from '../components/street/StreetView';
import { HUD } from '../components/hud/HUD';
import { MapPanel, type Device } from '../components/map/MapPanel';
import { LoadingOverlay } from '../components/ui/LoadingOverlay';

interface GameScreenProps {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  preferences: Preferences;
  /** Active difficulty (drives the round timer + HUD label). */
  difficulty?: Difficulty;
  /**
   * Called after each guess is submitted, so a server-authoritative solo run
   * can record it. `roundIndex` is 0-based; guess is the placed coordinate.
   */
  onGuessSubmitted?: (roundIndex: number, guess: LatLng) => void;
  onOpenSettings: () => void;
}

export function GameScreen({
  state,
  dispatch,
  preferences,
  difficulty = DEFAULT_DIFFICULTY,
  onGuessSubmitted,
  onOpenSettings,
}: GameScreenProps) {
  const ROUND_SECONDS = difficultyRoundSeconds(difficulty);
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
      // for display. `roundIndex` is 0-based here.
      onGuessSubmitted?.(state.roundIndex, effectiveGuess);
    },
    [dispatch, state, onGuessSubmitted],
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

  // ── Optional per-round timer ────────────────────────────
  const [secondsLeft, setSecondsLeft] = useState<number>(ROUND_SECONDS);
  const submitRef = useRef(submitGuess);
  submitRef.current = submitGuess;
  const guessRef = useRef(state.guess);
  guessRef.current = state.guess;

  // Reset the timer whenever a fresh round begins exploring.
  useEffect(() => {
    if (state.status === 'exploring') setSecondsLeft(ROUND_SECONDS);
  }, [state.roundIndex, state.status, ROUND_SECONDS]);

  const timerActive =
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

  return (
    <div className="noselect" style={{ position: 'absolute', inset: 0 }}>
      <StreetView
        location={location}
        onReady={handleReady}
        onNoPanorama={handleNoPanorama}
        onLoadError={handleLoadError}
      />

      <HUD
        round={state.roundIndex + 1}
        totalRounds={APP.roundsPerGame}
        score={totalScore}
        showTimer={preferences.timer}
        secondsLeft={preferences.timer ? secondsLeft : null}
        difficultyLabel={difficultyLabel(difficulty)}
        onOpenSettings={onOpenSettings}
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
        isLastRound={state.roundIndex + 1 >= APP.roundsPerGame}
        distanceKm={lastResult?.distanceKm ?? null}
        score={lastResult?.score ?? null}
        units={preferences.units}
      />

      {isLoading && <LoadingOverlay />}
    </div>
  );
}

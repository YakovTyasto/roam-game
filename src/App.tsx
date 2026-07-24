import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Preferences } from './types';
import { APP, MAX_GAME_SCORE } from './config/app';
import { hasGoogleMapsKey } from './config/env';
import { gameReducer } from './game/reducer';
import { initialGameState } from './game/state';
import { locationProvider } from './providers/LocationProvider';
import { parseRoomCodeFromUrl } from './multiplayer/inviteLink';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { GameScreen } from './screens/GameScreen';
import { FinalScreen } from './screens/FinalScreen';
import { SetupScreen } from './screens/SetupScreen';
import { ErrorScreen } from './screens/ErrorScreen';
import { Modal } from './components/ui/Modal';
import { SettingsContent } from './components/settings/SettingsContent';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { LoadingOverlay } from './components/ui/LoadingOverlay';

// Multiplayer (and the Supabase SDK it pulls in) is code-split so the solo
// experience stays lean and loads Supabase only when a player opens multiplayer.
const MultiplayerApp = lazy(() =>
  import('./screens/multiplayer/MultiplayerApp').then((m) => ({
    default: m.MultiplayerApp,
  })),
);

type AppMode = 'solo' | 'multiplayer';

const DEFAULT_PREFERENCES: Preferences = {
  timer: false,
  units: 'metric',
  reduceMotion: false,
};

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const [preferences, setPreferences] = useLocalStorage<Preferences>(
    `${APP.storagePrefix}:preferences`,
    DEFAULT_PREFERENCES,
  );
  const [bestScore, setBestScore] = useLocalStorage<number>(
    `${APP.storagePrefix}:bestScore`,
    0,
  );

  // Detect an invite link (?room=ABC234) once on load; jump straight into
  // multiplayer with the code prefilled, without breaking normal navigation.
  const initialRoomCode = useMemo(
    () =>
      typeof window !== 'undefined'
        ? parseRoomCodeFromUrl(window.location.search)
        : null,
    [],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [isBest, setIsBest] = useState(false);
  const [mode, setMode] = useState<AppMode>(initialRoomCode ? 'multiplayer' : 'solo');

  const online = useOnlineStatus();
  const systemReducedMotion = usePrefersReducedMotion();
  const reduceMotion = preferences.reduceMotion || systemReducedMotion;

  // Apply the reduce-motion preference globally.
  useEffect(() => {
    document.body.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  const hasKey = hasGoogleMapsKey();

  const startGame = useCallback(async () => {
    if (!hasKey) {
      setShowSetup(true);
      return;
    }
    setIsBest(false);
    const { locations, backups } = await locationProvider.getGameLocations(
      APP.roundsPerGame,
    );
    dispatch({ type: 'START_GAME', locations, backups });
  }, [hasKey]);

  // Persist the best score once a game finishes.
  const finalizedRef = useRef(false);
  useEffect(() => {
    if (state.status !== 'finalResult') {
      finalizedRef.current = false;
      return;
    }
    if (finalizedRef.current) return;
    finalizedRef.current = true;

    const total = state.results.reduce((sum, r) => sum + r.score, 0);
    if (total > bestScore) {
      setBestScore(total);
      setIsBest(true);
    }
  }, [state.status, state.results, bestScore, setBestScore]);

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) =>
      setPreferences((prev) => ({ ...prev, ...patch })),
    [setPreferences],
  );

  const goHome = useCallback(() => dispatch({ type: 'RESET' }), []);

  const renderScreen = () => {
    if (mode === 'multiplayer') {
      return (
        <Suspense fallback={<LoadingOverlay label="Loading multiplayer…" />}>
          <MultiplayerApp
            initialCode={initialRoomCode ?? ''}
            units={preferences.units}
            onExitHome={() => setMode('solo')}
          />
        </Suspense>
      );
    }

    if (showSetup) {
      return <SetupScreen onBack={() => setShowSetup(false)} />;
    }

    switch (state.status) {
      case 'welcome':
        return (
          <WelcomeScreen
            bestScore={bestScore}
            hasKey={hasKey}
            onStart={startGame}
            onStartMultiplayer={() => setMode('multiplayer')}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        );
      case 'finalResult':
        return (
          <FinalScreen
            results={state.results}
            isBest={isBest}
            units={preferences.units}
            onPlayAgain={startGame}
            onHome={goHome}
          />
        );
      case 'error':
        return <ErrorScreen message={state.error} onDismiss={goHome} />;
      default:
        return (
          <GameScreen
            state={state}
            dispatch={dispatch}
            preferences={preferences}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        );
    }
  };

  return (
    <>
      {renderScreen()}

      <Modal
        open={settingsOpen}
        title={`${APP.name} settings`}
        onClose={() => setSettingsOpen(false)}
      >
        <SettingsContent
          preferences={preferences}
          bestScore={bestScore}
          onChange={updatePreferences}
          onResetBest={() => {
            setBestScore(0);
            setIsBest(false);
          }}
        />
      </Modal>

      {!online && <OfflineBanner />}

      <span className="sr-only" aria-live="polite">
        {state.status === 'finalResult'
          ? `Game over. You scored ${state.results
              .reduce((s, r) => s + r.score, 0)
              .toLocaleString()} out of ${MAX_GAME_SCORE.toLocaleString()}.`
          : ''}
      </span>
    </>
  );
}

import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Preferences } from './types';
import { APP, MAX_GAME_SCORE } from './config/app';
import type { Difficulty } from './config/difficulty';
import { DEFAULT_DIFFICULTY, difficultyLabel, toDifficulty } from './config/difficulty';
import { hasGoogleMapsKey } from './config/env';
import { gameReducer } from './game/reducer';
import { initialGameState } from './game/state';
import { useSoloRun } from './solo/useSoloRun';
import { resetLocationHistory } from './utils/locationHistory';
import { useProfile } from './profile/useProfile';
import { parseRoomCodeFromUrl } from './multiplayer/inviteLink';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { NameScreen } from './screens/NameScreen';
import { SoloSetupScreen } from './screens/SoloSetupScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
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

type AppScreen = 'home' | 'solo-setup' | 'leaderboard' | 'multiplayer';

const DEFAULT_PREFERENCES: Preferences = {
  timer: false,
  units: 'metric',
  reduceMotion: false,
};

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const profile = useProfile();
  const soloRun = useSoloRun();

  const [preferences, setPreferences] = useLocalStorage<Preferences>(
    `${APP.storagePrefix}:preferences`,
    DEFAULT_PREFERENCES,
  );
  const [bestScore, setBestScore] = useLocalStorage<number>(
    `${APP.storagePrefix}:bestScore`,
    0,
  );
  const [soloDifficulty, setSoloDifficulty] = useLocalStorage<Difficulty>(
    `${APP.storagePrefix}:soloDifficulty`,
    DEFAULT_DIFFICULTY,
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
  const [startingSolo, setStartingSolo] = useState(false);
  const [activeDifficulty, setActiveDifficulty] = useState<Difficulty>(
    toDifficulty(soloDifficulty),
  );
  const [screen, setScreen] = useState<AppScreen>(
    initialRoomCode ? 'multiplayer' : 'home',
  );

  const online = useOnlineStatus();
  const systemReducedMotion = usePrefersReducedMotion();
  const reduceMotion = preferences.reduceMotion || systemReducedMotion;

  useEffect(() => {
    document.body.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  const hasKey = hasGoogleMapsKey();

  const startSolo = useCallback(
    async (difficulty: Difficulty) => {
      if (!hasKey) {
        setShowSetup(true);
        return;
      }
      setIsBest(false);
      setStartingSolo(true);
      setActiveDifficulty(difficulty);
      setSoloDifficulty(difficulty);
      try {
        const { locations, backups } = await soloRun.begin(difficulty);
        dispatch({ type: 'START_GAME', locations, backups });
        setScreen('home');
      } finally {
        setStartingSolo(false);
      }
    },
    [hasKey, soloRun, setSoloDifficulty],
  );

  const recordGuess = useCallback(
    (roundIndex: number, guess: { lat: number; lng: number }) =>
      soloRun.recordGuess(roundIndex, guess),
    [soloRun],
  );

  // Persist best score + finalize the server run once a game finishes.
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
    // Server-authoritative leaderboard finalization (no-op when not tracked).
    void soloRun.finalize();
  }, [state.status, state.results, bestScore, setBestScore, soloRun]);

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => setPreferences((prev) => ({ ...prev, ...patch })),
    [setPreferences],
  );

  const goHome = useCallback(() => {
    dispatch({ type: 'RESET' });
    setScreen('home');
  }, []);

  // ── Profile gating ────────────────────────────────────────────────────
  if (profile.status === 'loading') {
    return (
      <div style={{ position: 'relative', minHeight: '100dvh' }}>
        <LoadingOverlay label="Loading your profile…" />
      </div>
    );
  }
  if (profile.status === 'onboarding') {
    return (
      <NameScreen
        busy={profile.saving}
        error={profile.error}
        online={profile.online || !profile.supabaseConfigured}
        onSubmit={(name) => void profile.setName(name)}
      />
    );
  }

  const renderScreen = () => {
    if (screen === 'multiplayer') {
      return (
        <Suspense fallback={<LoadingOverlay label="Loading multiplayer…" />}>
          <MultiplayerApp
            initialCode={initialRoomCode ?? ''}
            units={preferences.units}
            playerName={profile.name ?? 'Player'}
            onExitHome={() => setScreen('home')}
          />
        </Suspense>
      );
    }

    if (showSetup) {
      return <SetupScreen onBack={() => setShowSetup(false)} />;
    }

    // A solo game/result is in progress regardless of the home screen behind it.
    if (state.status === 'finalResult') {
      return (
        <FinalScreen
          results={state.results}
          isBest={isBest}
          units={preferences.units}
          difficultyLabel={difficultyLabel(activeDifficulty)}
          onPlayAgain={() => void startSolo(activeDifficulty)}
          onHome={goHome}
        />
      );
    }
    if (state.status === 'error') {
      return <ErrorScreen message={state.error} onDismiss={goHome} />;
    }
    if (state.status !== 'welcome') {
      return (
        <GameScreen
          state={state}
          dispatch={dispatch}
          preferences={preferences}
          difficulty={activeDifficulty}
          onGuessSubmitted={recordGuess}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      );
    }

    if (screen === 'solo-setup') {
      return (
        <SoloSetupScreen
          initialDifficulty={toDifficulty(soloDifficulty)}
          busy={startingSolo}
          onStart={(d) => void startSolo(d)}
          onBack={() => setScreen('home')}
        />
      );
    }

    if (screen === 'leaderboard') {
      return <LeaderboardScreen onBack={() => setScreen('home')} />;
    }

    return (
      <WelcomeScreen
        bestScore={bestScore}
        hasKey={hasKey}
        playerName={profile.name}
        onStart={() => setScreen('solo-setup')}
        onStartMultiplayer={() => setScreen('multiplayer')}
        onOpenLeaderboard={() => setScreen('leaderboard')}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
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
          playerName={profile.name}
          online={profile.online}
          savingName={profile.saving}
          nameError={profile.error}
          onChangeName={(name) => void profile.setName(name)}
          onChange={updatePreferences}
          onResetBest={() => {
            setBestScore(0);
            setIsBest(false);
          }}
          onResetLocationHistory={resetLocationHistory}
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

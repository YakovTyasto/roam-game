import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { GameLocation, Preferences } from './types';
import { APP } from './config/app';
import type { Difficulty } from './config/difficulty';
import { DEFAULT_DIFFICULTY, difficultyLabel, toDifficulty } from './config/difficulty';
import type { GameConfig } from './config/gameConfig';
import { quickConfig } from './config/gameConfig';
import { hasGoogleMapsKey } from './config/env';
import { gameReducer } from './game/reducer';
import { initialGameState } from './game/state';
import { useSoloRun } from './solo/useSoloRun';
import { locationProvider } from './providers/LocationProvider';
import { pickNextEndlessLocation, shouldWarnEndlessUsage } from './utils/endlessSelection';
import { computeEndlessStats } from './utils/endlessStats';
import { readLocationHistory, resetLocationHistory } from './utils/locationHistory';
import { useProfile } from './profile/useProfile';
import { parseRoomCodeFromUrl } from './multiplayer/inviteLink';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { useTheme } from './hooks/useTheme';
import { decideThemeSync } from './config/theme';
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
import { EndlessUsageNotice } from './components/ui/EndlessUsageNotice';
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
  const theme = useTheme();

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
  const [activeConfig, setActiveConfig] = useState<GameConfig>(() =>
    quickConfig(toDifficulty(soloDifficulty), APP.roundsPerGame),
  );
  const activeDifficulty = activeConfig.difficulty;
  const [screen, setScreen] = useState<AppScreen>(
    initialRoomCode ? 'multiplayer' : 'home',
  );
  const [endlessNotice, setEndlessNotice] = useState<number | null>(null);

  const online = useOnlineStatus();
  const systemReducedMotion = usePrefersReducedMotion();
  const reduceMotion = preferences.reduceMotion || systemReducedMotion;

  useEffect(() => {
    document.body.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  // Reconcile the theme preference with the server profile once, without
  // blocking first paint (which already used the local/pre-paint value). If
  // this browser never had a stored preference, adopt the server's; otherwise
  // push the local value up so the server catches up.
  const themeSyncedRef = useRef(false);
  useEffect(() => {
    if (themeSyncedRef.current) return;
    if (profile.serverPreferences === undefined) return;
    themeSyncedRef.current = true;
    const decision = decideThemeSync(
      theme.hadStoredPreference,
      theme.preference,
      profile.serverPreferences.theme,
    );
    if (decision.action === 'adopt-server') {
      theme.setPreference(decision.theme);
    } else {
      profile.pushPreferences({ theme: decision.theme });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.serverPreferences]);

  const hasKey = hasGoogleMapsKey();

  const startSolo = useCallback(
    async (config: GameConfig) => {
      if (!hasKey) {
        setShowSetup(true);
        return;
      }
      setIsBest(false);
      setStartingSolo(true);
      setActiveConfig(config);
      setSoloDifficulty(config.difficulty);
      setEndlessNotice(null);
      endlessAllLocationsRef.current = null;
      try {
        const { locations, backups } = await soloRun.begin(config);
        dispatch({
          type: 'START_GAME',
          locations,
          backups,
          roundCount: config.roundCount,
          timerSeconds: config.timerSeconds,
        });
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

  // ── Endless: generate one round at a time (never a preallocated manifest) ──
  const endlessAllLocationsRef = useRef<GameLocation[] | null>(null);
  const endlessGeneratingRef = useRef(false);
  const isEndless = state.roundCount === null;

  useEffect(() => {
    if (state.status !== 'loadingRound') return;
    if (!isEndless) return;
    if (state.roundIndex < state.locations.length) return; // already have this round
    if (endlessGeneratingRef.current) return;
    endlessGeneratingRef.current = true;

    void (async () => {
      try {
        if (!endlessAllLocationsRef.current) {
          endlessAllLocationsRef.current = await locationProvider.getAll();
        }
        const excludeIds = new Set(state.locations.map((l) => l.id));
        const recentIds = readLocationHistory();
        const next = pickNextEndlessLocation(
          endlessAllLocationsRef.current,
          activeConfig.difficulty,
          excludeIds,
          recentIds,
        );
        if (!next) {
          dispatch({ type: 'SET_ERROR', message: 'No more locations are available right now.' });
          return;
        }
        dispatch({ type: 'ADD_ROUND', location: next });
      } finally {
        endlessGeneratingRef.current = false;
      }
    })();
  }, [state.status, state.roundIndex, state.locations, isEndless, activeConfig.difficulty]);

  // Informational notice every 25 Endless rounds (not a blocking dialog).
  useEffect(() => {
    if (!isEndless) return;
    const played = state.results.length;
    if (shouldWarnEndlessUsage(played)) setEndlessNotice(played);
  }, [isEndless, state.results.length]);

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
    // The "best score" stat represents the classic 5-round game only — other
    // round counts and Endless are shown in session stats, not compared here.
    if (state.roundCount === APP.roundsPerGame && total > bestScore) {
      setBestScore(total);
      setIsBest(true);
    }
    // Server-authoritative leaderboard finalization (no-op when not tracked).
    void soloRun.finalize();
  }, [state.status, state.results, state.roundCount, bestScore, setBestScore, soloRun]);

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => setPreferences((prev) => ({ ...prev, ...patch })),
    [setPreferences],
  );

  const goHome = useCallback(() => {
    dispatch({ type: 'RESET' });
    setScreen('home');
  }, []);

  // ── Exit flow (solo/Endless) ────────────────────────────────────────────
  // Save and exit: leaves the local UI state, but deliberately does NOT
  // abandon a server-tracked run — it stays 'active' server-side and is
  // resumable (see roam_get_active_solo_run; full resume UI is a separate,
  // dedicated pass). Local-only games (no Supabase, or Endless) have nothing
  // server-side to preserve yet, so this currently behaves like Abandon for
  // them — an accepted, honestly-scoped limitation until local resume lands.
  const saveAndExit = useCallback(() => {
    goHome();
  }, [goHome]);

  // Abandon: explicitly invalidates any server-tracked active run (never
  // creates a leaderboard result — finalize is never called) and clears only
  // this run's local state, leaving profile/best score/theme/location
  // history untouched.
  const abandonGame = useCallback(() => {
    void soloRun.abandon();
    goHome();
  }, [soloRun, goHome]);

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
          endlessStats={state.roundCount === null ? computeEndlessStats(state.results) : undefined}
          onPlayAgain={() => void startSolo(activeConfig)}
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
          onSaveAndExit={saveAndExit}
          onAbandon={abandonGame}
        />
      );
    }

    if (screen === 'solo-setup') {
      return (
        <SoloSetupScreen
          initialDifficulty={toDifficulty(soloDifficulty)}
          busy={startingSolo}
          onStart={(config) => void startSolo(config)}
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
          themePreference={theme.preference}
          onChangeTheme={(next) => {
            theme.setPreference(next);
            profile.pushPreferences({ theme: next });
          }}
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

      {endlessNotice !== null && (
        <EndlessUsageNotice roundsPlayed={endlessNotice} onDismiss={() => setEndlessNotice(null)} />
      )}

      <span className="sr-only" aria-live="polite">
        {state.status === 'finalResult'
          ? `Game over. You scored ${state.results
              .reduce((s, r) => s + r.score, 0)
              .toLocaleString()} out of ${(
              Math.max(1, state.results.length) * APP.maxRoundScore
            ).toLocaleString()}.`
          : ''}
      </span>
    </>
  );
}

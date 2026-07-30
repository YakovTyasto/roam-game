import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { GameLocation, Preferences } from './types';
import { APP } from './config/app';
import type { Difficulty } from './config/difficulty';
import { DEFAULT_DIFFICULTY, difficultyLabel, toDifficulty } from './config/difficulty';
import type { GameConfig } from './config/gameConfig';
import { quickConfig } from './config/gameConfig';
import { hasGoogleMapsKey, hasSupabaseConfig } from './config/env';
import { gameReducer } from './game/reducer';
import { initialGameState } from './game/state';
import { useSoloRun } from './solo/useSoloRun';
import type { OfficialRun } from './official/officialRun';
import {
  awaitingFinalize,
  hiddenPanoramasOf,
  nextRoundIndex,
  remainingSeconds,
  resultsOf,
} from './official/officialRun';
import type { LocalRunSnapshot } from './solo/localRunSnapshot';
import {
  clearLocalRunSnapshot,
  readLocalRunSnapshot,
  writeLocalRunSnapshot,
} from './solo/localRunSnapshot';
import { locationProvider } from './providers/LocationProvider';
import { pickNextEndlessLocation, shouldWarnEndlessUsage } from './utils/endlessSelection';
import { computeEndlessStats } from './utils/endlessStats';
import {
  commitRoundStarted,
  groupIdOf,
  readDiversityState,
  resetAllHistory,
} from './diversity/store';
import { syncLocationHistory } from './diversity/historySync';
import { withTimeout } from './utils/withTimeout';
import { useProfile } from './profile/useProfile';
import { parseRoomCodeFromUrl } from './multiplayer/inviteLink';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { useTheme } from './hooks/useTheme';
import { decideThemeSync } from './config/theme';
import { useLocale } from './hooks/useLocale';
import { isLocale } from './i18n/locale';
import { t } from './i18n/t';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { NameScreen } from './screens/NameScreen';
import { ResumePromptScreen } from './screens/ResumePromptScreen';
import { SoloSetupScreen } from './screens/SoloSetupScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { DailyScreen } from './screens/DailyScreen';
import { ChallengeScreen } from './screens/ChallengeScreen';
import { parseChallengeCodeFromUrl } from './challenge/challengeCode';
import { DailyCard } from './components/daily/DailyCard';
import { useDaily } from './daily/useDaily';
import { GameScreen } from './screens/GameScreen';
import { FinalScreen } from './screens/FinalScreen';
import { SetupScreen } from './screens/SetupScreen';
import { ErrorScreen } from './screens/ErrorScreen';
import { Modal } from './components/ui/Modal';
import { SettingsContent } from './components/settings/SettingsContent';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { EndlessUsageNotice } from './components/ui/EndlessUsageNotice';
import { UpdateAvailableBanner } from './components/ui/UpdateAvailableBanner';
import { useServiceWorkerUpdate } from './pwa/useServiceWorkerUpdate';
import { LoadingOverlay } from './components/ui/LoadingOverlay';

// Multiplayer (and the Supabase SDK it pulls in) is code-split so the solo
// experience stays lean and loads Supabase only when a player opens multiplayer.
const MultiplayerApp = lazy(() =>
  import('./screens/multiplayer/MultiplayerApp').then((m) => ({
    default: m.MultiplayerApp,
  })),
);

type AppScreen =
  | 'home'
  | 'solo-setup'
  | 'leaderboard'
  | 'multiplayer'
  | 'daily'
  | 'challenge';

/** The resume check never blocks rendering, but must still fail bounded. */
const RESUME_CHECK_TIMEOUT_MS = 8000;

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
  const locale = useLocale();

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

  // A challenge deep link (/challenge/CODE, or ?c=CODE on a host without
  // rewrites). Read once on load; a malformed code resolves to null so a bad
  // link lands on the home screen rather than an error the player can't explain.
  const initialChallengeCode = useMemo(
    () =>
      typeof window !== 'undefined'
        ? parseChallengeCodeFromUrl(window.location.pathname + window.location.search)
        : null,
    [],
  );
  const [challengeCode, setChallengeCode] = useState<string | null>(initialChallengeCode);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [isBest, setIsBest] = useState(false);
  const [startingSolo, setStartingSolo] = useState(false);
  /**
   * Whether the game in progress is an official, server-scored run. Drives the
   * "this game isn't ranked" messaging — a local fallback must never be
   * presented as a leaderboard result.
   */
  const [officialGame, setOfficialGame] = useState(false);
  const [localOnlyNotice, setLocalOnlyNotice] = useState<'offline' | 'unavailable' | null>(null);
  const [activeConfig, setActiveConfig] = useState<GameConfig>(() =>
    quickConfig(toDifficulty(soloDifficulty), APP.roundsPerGame),
  );
  const activeDifficulty = activeConfig.difficulty;
  const [screen, setScreen] = useState<AppScreen>(() => {
    if (initialRoomCode) return 'multiplayer';
    if (initialChallengeCode) return 'challenge';
    return 'home';
  });
  const [endlessNotice, setEndlessNotice] = useState<number | null>(null);


  const online = useOnlineStatus();
  const swUpdate = useServiceWorkerUpdate();
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

  // Same reconciliation shape as theme, for the locale preference.
  const localeSyncedRef = useRef(false);
  useEffect(() => {
    if (localeSyncedRef.current) return;
    if (profile.serverPreferences === undefined) return;
    localeSyncedRef.current = true;
    const serverLocale = profile.serverPreferences.locale;
    if (!locale.hadStoredLocale && isLocale(serverLocale)) {
      locale.setLocale(serverLocale);
    } else {
      profile.pushPreferences({ locale: locale.locale });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.serverPreferences]);

  // Accessibility: keep the document's declared language in sync.
  useEffect(() => {
    document.documentElement.lang = locale.locale;
  }, [locale.locale]);

  // Reconcile the durable location history in the background, once.
  //
  // Deliberately gated on nothing and awaited by nobody: selection reads the
  // local cache synchronously, so this can only ever *improve* variety. It is
  // bounded internally and swallows every failure, which is what keeps a slow
  // or hung backend from becoming an inert home screen — the V3 incident this
  // whole release is careful about.
  const historySyncedRef = useRef(false);
  useEffect(() => {
    if (historySyncedRef.current) return;
    historySyncedRef.current = true;
    void syncLocationHistory();
  }, []);

  const hasKey = hasGoogleMapsKey();
  // ── Daily Challenge ────────────────────────────────────────────────────
  // Loaded only once the player has a name (so it never competes with the
  // profile bootstrap) and never awaited by anything that renders a button.
  const daily = useDaily(profile.status === 'ready' && hasKey);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);

  // ── Official run resume ────────────────────────────────────────────────
  // Works for any active run in the table, including one started by a
  // pre-V5 client, because the v2 read is over the same rows.
  const [resumeCandidate, setResumeCandidate] = useState<OfficialRun | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const resumeRemainingRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (profile.status !== 'ready' || !hasSupabaseConfig() || !hasKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const { fetchOfficialRun, finalizeOfficialRun } = await import(
          './official/officialRunApi'
        );
        const run = await withTimeout(fetchOfficialRun(), RESUME_CHECK_TIMEOUT_MS);
        if (cancelled || !run) return;
        if (awaitingFinalize(run)) {
          // Every round was already guessed but the app closed before finalize
          // ran — finish it silently rather than re-prompting for a round that
          // is already fully scored (and never score it twice).
          await finalizeOfficialRun(run.runId).catch(() => {});
          return;
        }
        setResumeCandidate(run);
      } catch {
        // No reachable active run — a normal cold start, not an error to surface.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.status, hasKey]);

  const resumeGame = useCallback(() => {
    const run = resumeCandidate;
    if (!run) return;
    setResumeBusy(true);
    const results = resultsOf(run);
    const roundIndex = nextRoundIndex(run);
    soloRun.adopt(run, results.length);
    setActiveConfig({
      difficulty: run.difficulty,
      roundCount: run.roundCount,
      timerSeconds: run.timerSeconds,
      movementRule: 'default',
    });
    setSoloDifficulty(run.difficulty);
    setOfficialGame(true);
    // The remaining time comes from the server's own clock on both ends, so a
    // skewed device clock cannot extend a round (see officialRun.ts).
    resumeRemainingRef.current = remainingSeconds(run, roundIndex) ?? undefined;

    dispatch({
      type: 'START_OFFICIAL_GAME',
      hiddenPanoramas: hiddenPanoramasOf(run),
      results,
      roundIndex,
      roundCount: run.roundCount,
      timerSeconds: run.timerSeconds,
    });
    setResumeCandidate(null);
    setScreen('home');
    setResumeBusy(false);
  }, [resumeCandidate, soloRun, setSoloDifficulty]);

  const abandonResume = useCallback(async () => {
    if (!resumeCandidate) return;
    setResumeBusy(true);
    try {
      const { abandonSoloRun } = await import('./solo/soloRunApi');
      await abandonSoloRun(resumeCandidate.runId);
    } catch {
      /* best-effort — the 12h run expiry is the fallback */
    } finally {
      setResumeCandidate(null);
      setResumeBusy(false);
    }
  }, [resumeCandidate]);

  // ── Local-only resume (Endless, or fixed games with no Supabase) ───────
  const [localResumeCandidate, setLocalResumeCandidate] = useState<LocalRunSnapshot | null>(null);

  useEffect(() => {
    const snap = readLocalRunSnapshot();
    if (snap) setLocalResumeCandidate(snap);
  }, []);

  const resumeLocalGame = useCallback(() => {
    if (!localResumeCandidate) return;
    setActiveConfig({
      difficulty: localResumeCandidate.difficulty,
      roundCount: localResumeCandidate.roundCount,
      timerSeconds: localResumeCandidate.timerSeconds,
      movementRule: 'default',
    });
    setSoloDifficulty(localResumeCandidate.difficulty);
    dispatch({
      type: 'RESUME_GAME',
      locations: localResumeCandidate.locations,
      results: localResumeCandidate.results,
      roundIndex: localResumeCandidate.roundIndex,
      roundCount: localResumeCandidate.roundCount,
      timerSeconds: localResumeCandidate.timerSeconds,
      // A local snapshot always knows its own answers, so nothing is hidden.
      hiddenPanoramas: {},
    });
    setLocalResumeCandidate(null);
    setScreen('home');
  }, [localResumeCandidate, setSoloDifficulty]);

  // Snapshot a local-only game's progress after every round, so a refresh
  // can resume it — server-tracked games rely on the server instead (see
  // above), so this only runs while soloRun isn't tracking this game.
  useEffect(() => {
    if (state.status !== 'roundResult') return;
    if (soloRun.isOfficial()) return;
    writeLocalRunSnapshot({
      difficulty: activeConfig.difficulty,
      roundCount: state.roundCount,
      timerSeconds: state.timerSeconds,
      roundIndex: state.roundIndex,
      locations: state.locations,
      results: state.results,
    });
  }, [state.status, state.roundIndex, state.results, state.locations, state.roundCount, state.timerSeconds, activeConfig.difficulty, soloRun]);

  // Clear the local snapshot once a local-only game actually finishes.
  useEffect(() => {
    if (state.status === 'finalResult' && !soloRun.isOfficial()) {
      clearLocalRunSnapshot();
    }
  }, [state.status, soloRun]);

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
      committedRoundsRef.current.clear();
      clearLocalRunSnapshot();
      try {
        const begun = await soloRun.begin(config);
        resumeRemainingRef.current = undefined;
        if (begun.kind === 'official') {
          setOfficialGame(true);
          setLocalOnlyNotice(null);
          dispatch({
            type: 'START_OFFICIAL_GAME',
            hiddenPanoramas: hiddenPanoramasOf(begun.run),
            results: [],
            roundIndex: 0,
            roundCount: begun.run.roundCount,
            timerSeconds: begun.run.timerSeconds,
          });
        } else {
          setOfficialGame(false);
          // Say so, rather than letting a local game look like a ranked one.
          // Endless is local by design, so it is not a "couldn't reach the
          // server" message.
          setLocalOnlyNotice(begun.degradedReason ?? null);
          dispatch({
            type: 'START_GAME',
            locations: begun.locations,
            backups: begun.backups,
            roundCount: config.roundCount,
            timerSeconds: config.timerSeconds,
          });
        }
        setScreen('home');
      } finally {
        setStartingSolo(false);
      }
    },
    [hasKey, soloRun, setSoloDifficulty],
  );

  /**
   * Start, resume or practise today's Daily Challenge. The server decides which
   * of those it is — the client cannot talk itself into a second official
   * attempt, and a practice request before completion is refused server-side.
   */
  const startDaily = useCallback(
    async (practice: boolean) => {
      setDailyError(null);
      setDailyBusy(true);
      try {
        const { startDaily: start } = await import('./daily/dailyApi');
        const outcome = await start(practice);
        if (outcome.kind === 'already-completed') {
          daily.refresh();
          return;
        }
        const { run } = outcome;
        const played = resultsOf(run);
        const roundIndex = nextRoundIndex(run);
        soloRun.adopt(run, played.length);
        setActiveConfig({
          difficulty: run.difficulty,
          roundCount: run.roundCount,
          timerSeconds: run.timerSeconds,
          movementRule: 'default',
        });
        setOfficialGame(!outcome.practice);
        setLocalOnlyNotice(null);
        setIsBest(false);
        committedRoundsRef.current.clear();
        clearLocalRunSnapshot();
        resumeRemainingRef.current = remainingSeconds(run, roundIndex) ?? undefined;
        dispatch({
          type: 'START_OFFICIAL_GAME',
          hiddenPanoramas: hiddenPanoramasOf(run),
          results: played,
          roundIndex,
          roundCount: run.roundCount,
          timerSeconds: run.timerSeconds,
        });
        setScreen('home');
      } catch (err) {
        setDailyError(
          err instanceof Error ? err.message : 'The Daily Challenge could not be started.',
        );
      } finally {
        setDailyBusy(false);
      }
    },
    [daily, soloRun],
  );

  /** Start or resume a shared challenge attempt. */
  const startChallengeRun = useCallback(
    async (code: string) => {
      setStartingSolo(true);
      try {
        const { startChallenge } = await import('./challenge/challengeApi');
        const outcome = await startChallenge(code);
        if (outcome.kind === 'already-completed') return;
        const { run } = outcome;
        const played = resultsOf(run);
        const roundIndex = nextRoundIndex(run);
        soloRun.adopt(run, played.length);
        setActiveConfig({
          difficulty: run.difficulty,
          roundCount: run.roundCount,
          // A challenge created without a timer must not show one, even though
          // the run row always carries a duration for round expiry.
          timerSeconds: outcome.hasTimer ? run.timerSeconds : null,
          movementRule: 'default',
        });
        setOfficialGame(true);
        setLocalOnlyNotice(null);
        setIsBest(false);
        committedRoundsRef.current.clear();
        clearLocalRunSnapshot();
        resumeRemainingRef.current = remainingSeconds(run, roundIndex) ?? undefined;
        dispatch({
          type: 'START_OFFICIAL_GAME',
          hiddenPanoramas: hiddenPanoramasOf(run),
          results: played,
          roundIndex,
          roundCount: run.roundCount,
          timerSeconds: outcome.hasTimer ? run.timerSeconds : null,
        });
        setScreen('home');
      } catch {
        // The challenge screen keeps its own error surface; leaving the player
        // on it (rather than dropping them home) is the useful outcome.
      } finally {
        setStartingSolo(false);
      }
    },
    [soloRun],
  );

  const recordGuess = useCallback(
    (roundIndex: number, guess: { lat: number; lng: number }) =>
      soloRun.recordGuess(roundIndex, guess),
    [soloRun],
  );

  // ── Diversity: record a place only once its round genuinely starts ──────
  // Not at selection time. A five-round game selects all five up front, but a
  // player who quits after round two never saw rounds three to five — charging
  // them against the shuffle bag and the cooldown would burn freshness the
  // player never spent. `exploring` is the first status where the panorama is
  // live in front of the player.
  const committedRoundsRef = useRef(new Set<string>());
  useEffect(() => {
    if (state.status !== 'exploring') return;
    const location = state.locations[state.roundIndex];
    if (!location) return;
    const key = `${state.roundIndex}:${location.id}`;
    if (committedRoundsRef.current.has(key)) return;
    committedRoundsRef.current.add(key);
    void (async () => {
      const all = await locationProvider.getAll();
      commitRoundStarted({
        all,
        groupId: groupIdOf(all, location.id),
        // Endless has no fixed length; its pool is sized for a single round.
        count: state.roundCount ?? 1,
        difficulty: activeConfig.difficulty,
      });
    })();
  }, [state.status, state.roundIndex, state.locations, state.roundCount, activeConfig.difficulty]);

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
        const all = endlessAllLocationsRef.current;
        // Exclude by canonical group, not location id: two catalog rows for one
        // place must not both appear in a session.
        const excludeGroupIds = new Set(state.locations.map((l) => groupIdOf(all, l.id)));
        const { bag, recentGroupIds } = readDiversityState(activeConfig.difficulty);
        const next = pickNextEndlessLocation(
          all,
          activeConfig.difficulty,
          excludeGroupIds,
          recentGroupIds,
          undefined,
          { bag },
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
    // Server-authoritative finalization (no-op for a local game). The Daily
    // card's state is derived from the server, so refresh it once the run has
    // actually been finalized rather than optimistically.
    void soloRun.finalize().then(() => daily.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    clearLocalRunSnapshot();
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
  if (resumeCandidate && state.status === 'welcome') {
    return (
      <ResumePromptScreen
        difficulty={resumeCandidate.difficulty}
        roundIndex={nextRoundIndex(resumeCandidate)}
        roundCount={resumeCandidate.roundCount}
        roundsPlayed={resultsOf(resumeCandidate).length}
        busy={resumeBusy}
        onResume={resumeGame}
        onAbandon={() => void abandonResume()}
      />
    );
  }
  if (localResumeCandidate && state.status === 'welcome') {
    return (
      <ResumePromptScreen
        difficulty={localResumeCandidate.difficulty}
        roundIndex={localResumeCandidate.roundIndex}
        roundCount={localResumeCandidate.roundCount}
        roundsPlayed={localResumeCandidate.results.length}
        busy={resumeBusy}
        onResume={resumeLocalGame}
        onAbandon={() => {
          clearLocalRunSnapshot();
          setLocalResumeCandidate(null);
        }}
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
          unranked={
            officialGame
              ? undefined
              : state.roundCount === null
                ? 'endless'
                : !hasSupabaseConfig()
                  ? 'not-configured'
                  : (localOnlyNotice ?? 'unavailable')
          }
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
          resumeRemainingSeconds={resumeRemainingRef.current}
          locale={locale.locale}
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

    if (screen === 'challenge') {
      return (
        <ChallengeScreen
          locale={locale.locale}
          units={preferences.units}
          initialCode={challengeCode}
          onPlay={(code) => void startChallengeRun(code)}
          onBack={() => {
            setChallengeCode(null);
            // Drop the deep-link path so a refresh doesn't reopen the challenge.
            if (typeof window !== 'undefined' && window.location.pathname !== '/') {
              window.history.replaceState(null, '', '/');
            }
            setScreen('home');
          }}
        />
      );
    }

    if (screen === 'daily') {
      return (
        <DailyScreen
          locale={locale.locale}
          units={preferences.units}
          state={daily.state}
          status={daily.status}
          secondsUntilNext={daily.secondsUntilNext}
          busy={dailyBusy}
          error={dailyError}
          onPlay={() => void startDaily(false)}
          onPractice={() => void startDaily(true)}
          onRefresh={daily.refresh}
          onBack={() => setScreen('home')}
        />
      );
    }

    return (
      <WelcomeScreen
        bestScore={bestScore}
        hasKey={hasKey}
        playerName={profile.name}
        onStart={() => setScreen('solo-setup')}
        onStartMultiplayer={() => setScreen('multiplayer')}
        onOpenLeaderboard={() => setScreen('leaderboard')}
        onOpenChallenge={() => {
          setChallengeCode(null);
          setScreen('challenge');
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        dailyCard={
          <DailyCard
            locale={locale.locale}
            state={daily.state}
            status={daily.status}
            secondsUntilNext={daily.secondsUntilNext}
            onOpen={() => setScreen('daily')}
          />
        }
      />
    );
  };

  return (
    <>
      {renderScreen()}

      <Modal
        open={settingsOpen}
        title={t(locale.locale, 'settings.title', { name: APP.name })}
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
          locale={locale.locale}
          onChangeLocale={(next) => {
            locale.setLocale(next);
            profile.pushPreferences({ locale: next });
          }}
          onChangeName={(name) => void profile.setName(name)}
          onChange={updatePreferences}
          onResetBest={() => {
            setBestScore(0);
            setIsBest(false);
          }}
          onResetLocationHistory={resetAllHistory}
        />
      </Modal>

      {!online && <OfflineBanner />}

      {swUpdate.needsRefresh && (
        <UpdateAvailableBanner onUpdate={swUpdate.applyUpdate} onDismiss={swUpdate.dismiss} />
      )}

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

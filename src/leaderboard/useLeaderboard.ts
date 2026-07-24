import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig } from '../config/env';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import type { LeaderboardData, LeaderboardMode } from './types';

export type LeaderboardStatus = 'loading' | 'ready' | 'empty' | 'offline' | 'error';

export interface LeaderboardController {
  status: LeaderboardStatus;
  mode: LeaderboardMode;
  difficulty: Difficulty;
  data: LeaderboardData | null;
  setMode: (mode: LeaderboardMode) => void;
  setDifficulty: (difficulty: Difficulty) => void;
  refresh: () => void;
}

/** How often to refresh while the leaderboard is open and visible. */
const AUTO_REFRESH_MS = 60_000;

/**
 * Weekly leaderboard controller. Refreshes when opened, on filter change, on
 * manual refresh, and at a modest interval while visible — no persistent
 * Realtime subscription (the data is a weekly aggregate; polling is simpler and
 * more reliable, per the spec).
 */
export function useLeaderboard(
  initialMode: LeaderboardMode = 'solo',
  initialDifficulty: Difficulty = DEFAULT_DIFFICULTY,
): LeaderboardController {
  const configured = hasSupabaseConfig();
  const [mode, setMode] = useState<LeaderboardMode>(initialMode);
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [status, setStatus] = useState<LeaderboardStatus>(
    configured ? 'loading' : 'offline',
  );
  const [nonce, setNonce] = useState(0);
  const reqId = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!configured) {
      setStatus('offline');
      return;
    }
    const id = ++reqId.current;
    let cancelled = false;
    // Only show the full loading state on the first load; later refreshes keep
    // the current rows visible to avoid flicker.
    setStatus((prev) => (prev === 'ready' || prev === 'empty' ? prev : 'loading'));

    void (async () => {
      try {
        const { fetchLeaderboard } = await import('./leaderboardApi');
        const result = await fetchLeaderboard(mode, difficulty, 50);
        if (cancelled || id !== reqId.current) return;
        setData(result);
        setStatus(result.entries.length === 0 ? 'empty' : 'ready');
      } catch {
        if (cancelled || id !== reqId.current) return;
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configured, mode, difficulty, nonce]);

  // Modest auto-refresh while visible.
  useEffect(() => {
    if (!configured) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [configured, refresh]);

  return { status, mode, difficulty, data, setMode, setDifficulty, refresh };
}

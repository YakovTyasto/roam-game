import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig } from '../config/env';
import type { DailyStatus } from './daily';
import { secondsUntilNextDay } from './daily';

export type DailyLoadState = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface DailyController {
  state: DailyLoadState;
  status: DailyStatus | null;
  /** Seconds until the next UTC challenge, ticking locally, server-anchored. */
  secondsUntilNext: number | null;
  /** Re-fetch after a failure, or after finishing today's attempt. */
  refresh: () => void;
}

/**
 * Loads the Daily Challenge status without ever gating the rest of the app.
 *
 * Three properties matter more than anything else here, all of them lessons from
 * the V3 incident this codebase is careful about:
 *   • it starts AFTER first paint and nothing waits on it, so the home screen is
 *     interactive whether or not this resolves;
 *   • the underlying call is bounded (see dailyApi), and a failure lands in a
 *     visible `unavailable` state with a retry rather than an endless spinner;
 *   • the countdown ticks from the SERVER's clock plus locally-measured elapsed
 *     time, so it neither drifts with a wrong device clock nor needs polling.
 */
export function useDaily(enabled: boolean): DailyController {
  const [state, setState] = useState<DailyLoadState>('idle');
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [secondsUntilNext, setSecondsUntilNext] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const fetchedAtRef = useRef<number>(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !hasSupabaseConfig()) {
      setState('unavailable');
      return;
    }
    let cancelled = false;
    setState('loading');
    void (async () => {
      try {
        const { fetchDailyStatus } = await import('./dailyApi');
        const next = await fetchDailyStatus();
        if (cancelled) return;
        if (!next) {
          setState('unavailable');
          return;
        }
        fetchedAtRef.current = Date.now();
        setStatus(next);
        setSecondsUntilNext(secondsUntilNextDay(next));
        setState('ready');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  // One interval for the countdown, recomputed from the server anchor each tick
  // so a background tab that missed ticks catches up instead of lagging behind.
  useEffect(() => {
    if (state !== 'ready' || !status) return;
    const id = window.setInterval(() => {
      setSecondsUntilNext(secondsUntilNextDay(status, Date.now() - fetchedAtRef.current));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state, status]);

  return { state, status, secondsUntilNext, refresh };
}

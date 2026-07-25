import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig } from '../config/env';
import { validatePlayerName } from '../multiplayer/playerName';
import { friendlyRateLimitMessage, isRateLimitedError } from '../utils/rateLimit';
import {
  clearCachedProfile,
  readCachedProfile,
  writeCachedProfile,
} from './profileCache';

/**
 * Profile lifecycle:
 *   • 'loading'    — confirming the server profile (only when no cache exists,
 *                    so onboarding never flashes during a normal load)
 *   • 'onboarding' — no name yet; the welcome/name screen must be shown
 *   • 'ready'      — we have a name to play under
 *
 * `online` tells the UI whether the authoritative backend is reachable. When
 * Supabase is unavailable the app falls back to a LOCAL-ONLY name so solo play
 * still works; leaderboard/multiplayer surfaces report that online services are
 * unavailable.
 */
export type ProfileStatus = 'loading' | 'onboarding' | 'ready';

export interface ProfileController {
  status: ProfileStatus;
  name: string | null;
  /** Whether the authoritative server profile is confirmed/reachable. */
  online: boolean;
  /** True while the server is still being confirmed behind a cached name. */
  confirming: boolean;
  /** Whether online services (leaderboard/multiplayer) are configured at all. */
  supabaseConfigured: boolean;
  saving: boolean;
  error: string | null;
  /** Create or change the display name. Resolves true on success. */
  setName: (raw: string) => Promise<boolean>;
  /**
   * Server-synced theme/locale preferences, once known. `undefined` while
   * still loading (or unreachable/unconfigured); `null` fields mean the
   * player has never synced that preference.
   */
  serverPreferences?: { theme: string | null; locale: string | null };
  /** Best-effort, non-blocking push of a local preference to the server. */
  pushPreferences: (patch: { theme?: string; locale?: string }) => void;
}

export function useProfile(): ProfileController {
  const supabaseConfigured = hasSupabaseConfig();
  const cached = useRef(readCachedProfile()).current;

  const [name, setNameState] = useState<string | null>(cached?.name ?? null);
  const [status, setStatus] = useState<ProfileStatus>(() => {
    if (cached) return 'ready'; // optimistic — never flash onboarding
    if (!supabaseConfigured) return 'onboarding';
    return 'loading';
  });
  const [online, setOnline] = useState(false);
  const [confirming, setConfirming] = useState(supabaseConfigured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverPreferences, setServerPreferences] = useState<
    { theme: string | null; locale: string | null } | undefined
  >(undefined);

  // Reconcile against the server once, on mount, when configured.
  useEffect(() => {
    if (!supabaseConfigured) {
      setConfirming(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { fetchProfile, saveProfile } = await import('./profileApi');
        const profile = await fetchProfile();
        if (cancelled) return;
        setOnline(true);
        setServerPreferences({
          theme: profile.themePreference,
          locale: profile.localePreference,
        });
        if (profile.exists && profile.displayName) {
          writeCachedProfile(profile.displayName);
          setNameState(profile.displayName);
          setStatus('ready');
        } else if (cached) {
          // We have a local name but the server has none yet — migrate it up.
          try {
            const saved = await saveProfile(cached.name);
            if (cancelled) return;
            writeCachedProfile(saved);
            setNameState(saved);
            setStatus('ready');
          } catch {
            if (!cancelled) setStatus('ready'); // keep playing under local name
          }
        } else {
          setStatus('onboarding');
        }
      } catch {
        if (cancelled) return;
        // Backend unreachable. Fall back to the cached name if we have one;
        // otherwise the user can still set a local-only name to start.
        setOnline(false);
        setStatus(cached ? 'ready' : 'onboarding');
      } finally {
        if (!cancelled) setConfirming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseConfigured]);

  const setName = useCallback(
    async (raw: string): Promise<boolean> => {
      const valid = validatePlayerName(raw);
      if (!valid.ok) {
        setError(valid.error);
        return false;
      }
      setError(null);
      setSaving(true);
      // Cache immediately for instant, offline-tolerant UX.
      writeCachedProfile(valid.name);
      setNameState(valid.name);
      setStatus('ready');

      if (supabaseConfigured) {
        try {
          const { saveProfile } = await import('./profileApi');
          const saved = await saveProfile(valid.name);
          writeCachedProfile(saved);
          setNameState(saved);
          setOnline(true);
        } catch (err) {
          const message = err instanceof Error ? err.message : '';
          if (isRateLimitedError(message)) {
            // Still saved locally — only the server sync was rejected.
            setError(friendlyRateLimitMessage());
          } else {
            // Saved locally; the server will catch up on the next successful call.
            setOnline(false);
            setError('Saved locally — online services are currently unavailable.');
          }
        }
      }
      setSaving(false);
      return true;
    },
    [supabaseConfigured],
  );

  const pushPreferences = useCallback(
    (patch: { theme?: string; locale?: string }) => {
      if (!supabaseConfigured) return;
      void (async () => {
        try {
          const { syncPreferences } = await import('./profileApi');
          await syncPreferences(patch);
        } catch {
          // Best-effort — local storage already holds the authoritative value.
        }
      })();
    },
    [supabaseConfigured],
  );

  return {
    status,
    name,
    online,
    confirming,
    supabaseConfigured,
    saving,
    error,
    setName,
    serverPreferences,
    pushPreferences,
  };
}

/** Exposed for tests / account reset flows. */
export { clearCachedProfile };

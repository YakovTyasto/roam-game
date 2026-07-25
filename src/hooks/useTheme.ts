import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '../config/theme';

function readStoredPreference(): ThemePreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isThemePreference(parsed) ? parsed : null;
  } catch {
    // Malformed JSON / storage unavailable — fail safe, discard silently.
    return null;
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[resolved]);
}

export interface ThemeController {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  /** True if a valid preference already existed in storage before this session. */
  hadStoredPreference: boolean;
  setPreference: (preference: ThemePreference) => void;
}

/**
 * Local-first theme controller. The pre-paint script in `index.html` already
 * applies the resolved theme before React mounts (avoiding a flash); this hook
 * keeps it in sync afterwards and reacts to live OS theme changes while the
 * preference is 'system'.
 */
export function useTheme(): ThemeController {
  const initial = useRef(readStoredPreference()).current;
  const [preference, setPreferenceState] = useState<ThemePreference>(
    initial ?? DEFAULT_THEME_PREFERENCE,
  );
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    // Older Safari only supports addListener/removeListener.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeStoredPreference(next);
  }, []);

  return { preference, resolved, hadStoredPreference: initial !== null, setPreference };
}

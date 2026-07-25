/**
 * Theme system — Dark / Light / System.
 *
 * The stored preference and its resolution logic are duplicated (intentionally
 * minimally) in the pre-paint inline script in `index.html`, which must run
 * synchronously before any stylesheet paints to avoid a flash of the wrong
 * theme. Keep both in sync if this file changes.
 */

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

/** Versioned localStorage key — bump the suffix if the stored shape changes. */
export const THEME_STORAGE_KEY = 'roam.theme.v1';

/** New players default to following the OS/browser preference. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'] as const;

/** `<meta name="theme-color">` value applied for each resolved theme. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#0d0f0d',
  light: '#f6f7f2',
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

/** Resolve a preference to an actual dark/light theme given the OS setting. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export type PreferenceSyncDecision =
  | { action: 'adopt-server'; theme: ThemePreference }
  | { action: 'push-local'; theme: ThemePreference };

/**
 * Decide how to reconcile the local theme preference with a server profile
 * fetched after first paint. Local storage is always the immediate source for
 * first paint (never blocked on this), so this only runs once, after load:
 *   - a browser with no prior local choice adopts whatever the server has;
 *   - a browser with an existing local choice pushes it up instead, so the
 *     server (and other devices) catch up to what this browser already shows.
 */
export function decideThemeSync(
  hadStoredPreference: boolean,
  localPreference: ThemePreference,
  serverTheme: string | null,
): PreferenceSyncDecision {
  if (!hadStoredPreference && isThemePreference(serverTheme)) {
    return { action: 'adopt-server', theme: serverTheme };
  }
  return { action: 'push-local', theme: localPreference };
}

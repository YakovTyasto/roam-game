import { getSupabase } from '../multiplayer/supabaseClient';
import { ensureAnonymousSession } from '../multiplayer/auth';

/**
 * Supabase-backed profile operations. This module statically imports the
 * Supabase client, so it is only ever loaded via dynamic `import()` (see
 * useProfile) — keeping the Supabase SDK out of the main bundle when the app
 * runs without a backend.
 */

export interface ServerProfile {
  exists: boolean;
  displayName: string | null;
  /** Nullable — the player has never synced a theme preference to the server. */
  themePreference: string | null;
  /** Nullable — the player has never synced a locale preference to the server. */
  localePreference: string | null;
}

function parse(data: unknown): ServerProfile {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const exists = obj.exists === true;
    const name = typeof obj.display_name === 'string' ? obj.display_name : null;
    const theme = typeof obj.theme_preference === 'string' ? obj.theme_preference : null;
    const locale = typeof obj.locale_preference === 'string' ? obj.locale_preference : null;
    return {
      exists,
      displayName: exists ? name : null,
      themePreference: exists ? theme : null,
      localePreference: exists ? locale : null,
    };
  }
  return { exists: false, displayName: null, themePreference: null, localePreference: null };
}

/** Ensure an anonymous session exists and return the user id. */
export async function ensureSession(): Promise<string> {
  return ensureAnonymousSession();
}

/** Fetch the current user's profile (creating a session if needed). */
export async function fetchProfile(): Promise<ServerProfile> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc('roam_get_profile');
  if (error) throw new Error(error.message);
  return parse(data);
}

/** Create or rename the current user's profile; returns the stored name. */
export async function saveProfile(name: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');
  await ensureAnonymousSession();
  const { data, error } = await supabase.rpc('roam_upsert_profile', { p_name: name });
  if (error) throw new Error(error.message);
  const obj = (data ?? {}) as Record<string, unknown>;
  return typeof obj.display_name === 'string' ? obj.display_name : name;
}

/**
 * Best-effort, non-blocking sync of theme/locale preferences to the server
 * profile (a no-op if no profile row exists yet). Either argument may be
 * omitted to leave that preference untouched server-side.
 */
export async function syncPreferences(patch: {
  theme?: string;
  locale?: string;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await ensureAnonymousSession();
  const { error } = await supabase.rpc('roam_set_preferences', {
    p_theme: patch.theme ?? null,
    p_locale: patch.locale ?? null,
  });
  if (error) throw new Error(error.message);
}

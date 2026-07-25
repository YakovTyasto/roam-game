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
}

function parse(data: unknown): ServerProfile {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const exists = obj.exists === true;
    const name = typeof obj.display_name === 'string' ? obj.display_name : null;
    return { exists, displayName: exists ? name : null };
  }
  return { exists: false, displayName: null };
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

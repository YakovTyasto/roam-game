import { getSupabase } from './supabaseClient';

/**
 * Ensure there is a persistent anonymous Supabase session and return the user
 * id. Anonymous auth gives every player a stable `auth.uid()` that the database
 * RPCs and RLS policies key on — without requiring accounts.
 *
 * The session is persisted in browser storage, so a refresh keeps the same
 * identity and the player can reconnect to their room. We never sign the user
 * out automatically.
 *
 * Documented limitation: an anonymous identity lives only in this browser's
 * storage. Clearing site data, using a private window, or switching devices
 * creates a brand-new identity that cannot rejoin a room as the same player.
 */
export async function ensureAnonymousSession(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Multiplayer is not configured.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const existing = sessionData.session?.user?.id;
  if (existing) return existing;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Surface a friendly, non-sensitive message. The most common cause is that
    // anonymous sign-ins are disabled in the Supabase dashboard.
    throw new Error(
      'Could not start an anonymous session. Make sure anonymous sign-ins are enabled in your Supabase project.',
    );
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new Error('Anonymous sign-in did not return a user.');
  }
  return userId;
}

/** Current user id if a session already exists, else null. Never throws. */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

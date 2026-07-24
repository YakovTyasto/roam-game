/** Runtime access to environment configuration. */

export const GOOGLE_MAPS_API_KEY: string = (
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
).trim();

/** Whether a Google Maps key is configured. Drives the setup screen. */
export const hasGoogleMapsKey = (): boolean => GOOGLE_MAPS_API_KEY.length > 0;

/**
 * Supabase browser configuration for the optional private multiplayer mode.
 *
 * Only the PUBLISHABLE (browser) key is used here — never a secret/service_role
 * key. A browser key is always visible to users; Row Level Security on the
 * database is what actually protects the data (see supabase/migrations).
 *
 * Both values are optional: when either is missing, solo mode works exactly as
 * before and multiplayer shows a friendly "not configured" message instead of
 * crashing.
 */
export const SUPABASE_URL: string = (
  import.meta.env.VITE_SUPABASE_URL ?? ''
).trim();

export const SUPABASE_PUBLISHABLE_KEY: string = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
).trim();

/** Whether Supabase is configured. Drives whether multiplayer is available. */
export const hasSupabaseConfig = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;

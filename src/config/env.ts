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

/**
 * Optional Cloudflare Turnstile site key for production CAPTCHA on the
 * anonymous sign-in bootstrap (see docs/CAPTCHA_SETUP.md). This is a PUBLIC
 * site key — safe to ship in the client bundle, same as the Supabase and
 * Google Maps keys above. The matching secret key lives only in the
 * Supabase Dashboard (Auth → Attack Protection), never in any Vite/client
 * variable. Unset by default: CAPTCHA stays off until explicitly configured,
 * so local development and tests are never blocked by it.
 */
export const TURNSTILE_SITE_KEY: string = (
  import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
).trim();

export const hasTurnstileConfig = (): boolean => TURNSTILE_SITE_KEY.length > 0;

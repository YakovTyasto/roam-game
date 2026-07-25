import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, hasSupabaseConfig } from '../config/env';
import type { Database } from './database.types';

/**
 * Lazily-created Supabase browser client.
 *
 * Design goals (see the multiplayer task spec):
 *   • The client is created ONCE, on first use, and cached — never at module
 *     import time. Importing this module (e.g. so tests can reach the pure
 *     helpers) must not construct a real client or touch the network.
 *   • When the Supabase env vars are missing, `getSupabase()` returns `null`
 *     instead of throwing, so callers can show a friendly "not configured"
 *     message and solo mode keeps working.
 *   • The same holds for a *malformed* config (e.g. VITE_SUPABASE_URL isn't
 *     a valid URL): `createClient()` can throw synchronously in that case,
 *     and at least one call site (`useMultiplayer`'s `useMemo`) invokes this
 *     during render, outside any try/catch — an uncaught throw there would
 *     crash the whole app the moment a player opens multiplayer. Never let a
 *     configuration mistake become a hard crash; treat it as "unavailable"
 *     and remember *why* so the UI can show a clear configuration error
 *     instead of silently behaving like solo-only mode.
 *
 * Only the PUBLISHABLE (browser) key is ever used. Row Level Security on the
 * database is the real protection — never ship a secret/service_role key.
 */

export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | null = null;
let attempted = false;
let configError: string | null = null;

export function getSupabase(): TypedSupabaseClient | null {
  if (attempted) return client;
  attempted = true;

  if (!hasSupabaseConfig()) return null;

  try {
    client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        // Persist the anonymous session so a refresh keeps the same identity and
        // the player can reconnect to their room. We deliberately do NOT sign the
        // user out when they leave a room.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'roam-mp-auth',
      },
      realtime: {
        // We reconcile from the database on every event, so a modest event rate
        // is plenty — no need for a high-frequency firehose.
        params: { eventsPerSecond: 5 },
      },
    });
  } catch (err) {
    // A malformed URL/key throws synchronously inside createClient(). Fail
    // safe: behave exactly like "not configured" rather than propagating.
    client = null;
    configError = err instanceof Error ? err.message : 'Invalid Supabase configuration.';
  }
  return client;
}

/**
 * Set once `getSupabase()` has been called and returned `null` because the
 * configured URL/key was malformed (not merely absent) — lets the UI show a
 * clear configuration error instead of a generic "offline" message.
 */
export function getSupabaseConfigError(): string | null {
  return configError;
}

/** Test-only: reset the memoised client so config changes take effect. */
export function __resetSupabaseForTests(): void {
  client = null;
  attempted = false;
  configError = null;
}

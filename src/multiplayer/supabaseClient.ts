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
 *
 * Only the PUBLISHABLE (browser) key is ever used. Row Level Security on the
 * database is the real protection — never ship a secret/service_role key.
 */

export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | null = null;
let attempted = false;

export function getSupabase(): TypedSupabaseClient | null {
  if (attempted) return client;
  attempted = true;

  if (!hasSupabaseConfig()) return null;

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
  return client;
}

/** Test-only: reset the memoised client so config changes take effect. */
export function __resetSupabaseForTests(): void {
  client = null;
  attempted = false;
}

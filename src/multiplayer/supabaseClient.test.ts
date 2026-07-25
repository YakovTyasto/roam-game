import { afterEach, describe, it, expect, vi } from 'vitest';
import { hasSupabaseConfig } from '../config/env';
import { getSupabase, __resetSupabaseForTests } from './supabaseClient';

/**
 * The test environment has no VITE_SUPABASE_* variables, which is exactly the
 * "multiplayer not configured" case. Importing the client module must not throw
 * or construct a real client, and getSupabase() must return null so solo mode
 * keeps working and multiplayer can show a friendly setup message.
 */
describe('supabase client (missing configuration)', () => {
  it('reports no Supabase config in the test environment', () => {
    expect(hasSupabaseConfig()).toBe(false);
  });

  it('getSupabase() returns null instead of throwing when unconfigured', () => {
    __resetSupabaseForTests();
    expect(getSupabase()).toBeNull();
  });

  it('is stable across repeated calls (memoised)', () => {
    __resetSupabaseForTests();
    expect(getSupabase()).toBeNull();
    expect(getSupabase()).toBeNull();
  });
});

/**
 * A *malformed* config (present but invalid, e.g. a typo'd URL) is a
 * different failure mode than "missing" — createClient() can throw
 * synchronously. getSupabase() is called during render in at least one
 * place (useMultiplayer's useMemo), outside any try/catch, so a raw throw
 * here would crash the whole app the moment a player opens multiplayer —
 * regardless of solo mode. This must degrade to "unavailable", never crash.
 */
describe('supabase client (malformed configuration)', () => {
  afterEach(() => {
    vi.doUnmock('../config/env');
    vi.doUnmock('@supabase/supabase-js');
    vi.resetModules();
  });

  it('getSupabase() catches a synchronous createClient() throw and returns null', async () => {
    vi.resetModules();
    vi.doMock('../config/env', () => ({
      hasSupabaseConfig: () => true,
      SUPABASE_URL: 'not a valid url',
      SUPABASE_PUBLISHABLE_KEY: 'some-key',
    }));
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => {
        throw new TypeError('Failed to construct \'URL\': Invalid URL');
      },
    }));

    const mod = await import('./supabaseClient');
    mod.__resetSupabaseForTests();

    expect(() => mod.getSupabase()).not.toThrow();
    expect(mod.getSupabase()).toBeNull();
    expect(mod.getSupabaseConfigError()).toContain('Invalid URL');
  });

  it('records no config error on the ordinary "not configured" path', async () => {
    vi.resetModules();
    const mod = await import('./supabaseClient');
    mod.__resetSupabaseForTests();
    expect(mod.getSupabase()).toBeNull();
    expect(mod.getSupabaseConfigError()).toBeNull();
  });
});

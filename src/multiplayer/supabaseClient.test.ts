import { describe, it, expect } from 'vitest';
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

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Regression coverage for a second "silently unresponsive" gap found while
// investigating the entry-buttons incident: a *malformed* (present but
// invalid) Supabase config makes getSupabase() return null while
// hasSupabaseConfig() still reports true. Before this fix, useMultiplayer's
// authenticate() just returned early with nothing to show — the status
// stayed stuck on 'authenticating' forever, which renders only a bare
// LoadingOverlay with zero buttons and no way out. It must instead surface
// as a normal auth error, which already has a working "Back to home" screen.

vi.mock('../config/env', () => ({
  hasGoogleMapsKey: () => true,
  hasSupabaseConfig: () => true,
}));

vi.mock('./supabaseClient', () => ({
  getSupabase: () => null,
  getSupabaseConfigError: () => "Failed to construct 'URL': Invalid URL",
}));

vi.mock('./auth', () => ({
  ensureAnonymousSession: vi.fn(),
}));

async function flushMicrotasks(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('useMultiplayer — malformed Supabase config never hangs on "authenticating"', () => {
  afterEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it('surfaces the config error as a normal auth error instead of hanging', async () => {
    const { useMultiplayer } = await import('./useMultiplayer');
    const { result } = renderHook(() => useMultiplayer(''));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.authError).toContain('Invalid URL');
  });
});

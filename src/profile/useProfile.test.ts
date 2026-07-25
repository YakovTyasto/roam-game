import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression coverage for the "entry buttons unresponsive" incident: a
// fresh visitor (no cached profile) sees ONLY a full-screen loading spinner
// — no buttons at all — until the profile bootstrap resolves. If that
// network round trip hangs (cold backend, DNS/CORS misconfiguration), the
// app must still reach an interactive state within a bounded time rather
// than leaving the player stuck forever. See src/utils/withTimeout.ts.

vi.mock('../config/env', () => ({
  hasSupabaseConfig: () => true,
}));

const fetchProfileMock = vi.fn();
const saveProfileMock = vi.fn();
vi.mock('./profileApi', () => ({
  fetchProfile: (...args: unknown[]) => fetchProfileMock(...args),
  saveProfile: (...args: unknown[]) => saveProfileMock(...args),
}));

// vi.useFakeTimers() mocks setTimeout/setInterval but not the microtask
// queue, so promise resolutions inside the hook still need explicit
// flushing here — testing-library's waitFor polls via a real setInterval,
// which never fires under fake timers and would hang every test.
async function flushMicrotasks(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('useProfile — bootstrap never hangs indefinitely', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchProfileMock.mockReset();
    saveProfileMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to onboarding once the bootstrap round trip times out, for a fresh visitor', async () => {
    // A hung fetch: never resolves, never rejects — exactly what a stalled
    // connection or a misconfigured backend looks like from the client.
    fetchProfileMock.mockImplementation(() => new Promise(() => {}));

    const { useProfile } = await import('./useProfile');
    const { result } = renderHook(() => useProfile());

    await act(async () => {
      await flushMicrotasks();
    });
    // Stuck behind the spinner while the request is still "in flight".
    expect(result.current.status).toBe('loading');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8001);
      await flushMicrotasks();
    });

    expect(result.current.status).toBe('onboarding');
    expect(result.current.online).toBe(false);
  });

  it('reaches ready quickly when the bootstrap resolves normally (no regression from the timeout)', async () => {
    fetchProfileMock.mockResolvedValue({
      exists: true,
      displayName: 'Alex',
      themePreference: null,
      localePreference: null,
    });

    const { useProfile } = await import('./useProfile');
    const { result } = renderHook(() => useProfile());

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.name).toBe('Alex');
    expect(result.current.online).toBe(true);
  });

  it('does not leave "saving" stuck forever if saveProfile hangs from the onboarding screen', async () => {
    fetchProfileMock.mockResolvedValue({ exists: false, themePreference: null, localePreference: null });
    saveProfileMock.mockImplementation(() => new Promise(() => {})); // hangs

    const { useProfile } = await import('./useProfile');
    const { result } = renderHook(() => useProfile());

    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.status).toBe('onboarding');

    let setNamePromise!: Promise<boolean>;
    act(() => {
      setNamePromise = result.current.setName('NewPlayer');
    });

    await act(async () => {
      await flushMicrotasks();
    });
    // Optimistic local-first UX: status flips to 'ready' immediately, the
    // hung server call must not block that.
    expect(result.current.status).toBe('ready');
    expect(result.current.saving).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8001);
      await flushMicrotasks();
    });
    await setNamePromise;

    expect(result.current.saving).toBe(false);
  });
});

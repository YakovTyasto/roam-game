import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useExitGuard } from './useExitGuard';

describe('useExitGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when inactive', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    renderHook(() => useExitGuard(false, vi.fn()));
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('pushes a sentinel history entry when active', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    renderHook(() => useExitGuard(true, vi.fn()));
    expect(pushSpy).toHaveBeenCalledWith({ roamExitGuard: true }, '');
  });

  it('intercepts a Back navigation via popstate instead of leaving', () => {
    const onBack = vi.fn();
    renderHook(() => useExitGuard(true, onBack));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('re-arms the guard after every popstate (no repeated silent exits)', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    renderHook(() => useExitGuard(true, vi.fn()));
    const callsAfterMount = pushSpy.mock.calls.length;
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(pushSpy.mock.calls.length).toBe(callsAfterMount + 2);
  });

  it('shows a native confirmation on refresh/tab-close while active', () => {
    renderHook(() => useExitGuard(true, vi.fn()));
    const event = new Event('beforeunload', { cancelable: true });
    const notCancelled = window.dispatchEvent(event);
    expect(notCancelled).toBe(false); // preventDefault() was called
  });

  it('does not intercept refresh/tab-close when inactive', () => {
    renderHook(() => useExitGuard(false, vi.fn()));
    const event = new Event('beforeunload', { cancelable: true });
    const notCancelled = window.dispatchEvent(event);
    expect(notCancelled).toBe(true);
  });

  it('cleans up listeners on unmount — never traps the user', () => {
    const onBack = vi.fn();
    const { unmount } = renderHook(() => useExitGuard(true, onBack));
    unmount();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../config/theme';
import { useTheme } from './useTheme';

type Listener = (e: MediaQueryListEvent) => void;

function mockMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_type: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => mql),
  );
  return {
    setDark(next: boolean) {
      dark = next;
      listeners.forEach((cb) => cb({ matches: dark } as MediaQueryListEvent));
    },
  };
}

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to system and resolves against the OS preference', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists an explicit choice to roam.theme.v1', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('dark'));
    expect(result.current.resolved).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(JSON.stringify('dark'));
  });

  it('loads a previously stored preference on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify('light'));
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('light');
    expect(result.current.resolved).toBe('light');
    expect(result.current.hadStoredPreference).toBe(true);
  });

  it('discards malformed stored JSON and falls back to system', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, '{not json');
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.hadStoredPreference).toBe(false);
  });

  it('discards an unknown stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify('purple'));
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.hadStoredPreference).toBe(false);
  });

  it('reacts live to system theme changes while on system', () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    act(() => media.setDark(true));
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores system changes once an explicit theme is chosen', () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    act(() => media.setDark(true));
    expect(result.current.resolved).toBe('light');
  });
});

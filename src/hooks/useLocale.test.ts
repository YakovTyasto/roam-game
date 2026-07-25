import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_STORAGE_KEY } from '../i18n/locale';
import { useLocale } from './useLocale';

describe('useLocale', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the browser language when nothing is stored', () => {
    vi.stubGlobal('navigator', { languages: ['ru-RU'], language: 'ru-RU' });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('ru');
    expect(result.current.hadStoredLocale).toBe(false);
  });

  it('falls back to English when the browser language is unsupported', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR'], language: 'fr-FR' });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('en');
  });

  it('loads a previously stored locale over the browser default', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify('ru'));
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('ru');
    expect(result.current.hadStoredLocale).toBe(true);
  });

  it('persists an explicit choice', () => {
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    const { result } = renderHook(() => useLocale());
    act(() => result.current.setLocale('ru'));
    expect(result.current.locale).toBe('ru');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(JSON.stringify('ru'));
  });

  it('discards malformed stored data and falls back to the browser default', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, '{not json');
    vi.stubGlobal('navigator', { languages: ['ru-RU'], language: 'ru-RU' });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('ru');
    expect(result.current.hadStoredLocale).toBe(false);
  });

  it('discards an unsupported stored value', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify('fr'));
    vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' });
    const { result } = renderHook(() => useLocale());
    expect(result.current.locale).toBe('en');
    expect(result.current.hadStoredLocale).toBe(false);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  PROFILE_CACHE_KEY,
  clearCachedProfile,
  readCachedProfile,
  writeCachedProfile,
} from './profileCache';

afterEach(() => {
  window.localStorage.clear();
});

describe('profile cache (versioned local storage)', () => {
  it('round-trips a sanitized name', () => {
    writeCachedProfile('  Alex  ');
    expect(readCachedProfile()).toEqual({ version: 1, name: 'Alex' });
  });

  it('strips control characters and angle brackets on write', () => {
    writeCachedProfile('Al<b>ex');
    expect(readCachedProfile()?.name).toBe('Albex');
  });

  it('returns null for an empty/whitespace name', () => {
    writeCachedProfile('   ');
    expect(readCachedProfile()).toBeNull();
  });

  it('ignores a payload from a different cache version', () => {
    window.localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ version: 2, name: 'Future' }),
    );
    expect(readCachedProfile()).toBeNull();
  });

  it('ignores corrupt JSON', () => {
    window.localStorage.setItem(PROFILE_CACHE_KEY, '{not json');
    expect(readCachedProfile()).toBeNull();
  });

  it('clears the cached profile', () => {
    writeCachedProfile('Alex');
    clearCachedProfile();
    expect(readCachedProfile()).toBeNull();
  });
});

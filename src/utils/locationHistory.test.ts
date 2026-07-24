import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCATION_HISTORY_KEY,
  LOCATION_HISTORY_LIMIT,
  readLocationHistory,
  recordPlayedLocations,
  resetLocationHistory,
} from './locationHistory';

afterEach(() => {
  window.localStorage.clear();
});

describe('location history (versioned local storage)', () => {
  it('is empty when nothing has been recorded', () => {
    expect(readLocationHistory()).toEqual([]);
  });

  it('records played locations newest-first', () => {
    recordPlayedLocations(['a', 'b', 'c']);
    expect(readLocationHistory()).toEqual(['a', 'b', 'c']);
  });

  it('moves newly played ids to the front on subsequent recordings', () => {
    recordPlayedLocations(['a', 'b', 'c']);
    recordPlayedLocations(['d', 'e']);
    expect(readLocationHistory()).toEqual(['d', 'e', 'a', 'b', 'c']);
  });

  it('deduplicates when a location is played again, moving it to the front', () => {
    recordPlayedLocations(['a', 'b', 'c']);
    recordPlayedLocations(['b']);
    expect(readLocationHistory()).toEqual(['b', 'a', 'c']);
  });

  it('caps history at LOCATION_HISTORY_LIMIT unique ids', () => {
    const first = Array.from({ length: LOCATION_HISTORY_LIMIT }, (_, i) => `loc-${i}`);
    recordPlayedLocations(first);
    expect(readLocationHistory()).toHaveLength(LOCATION_HISTORY_LIMIT);

    recordPlayedLocations(['newest']);
    const history = readLocationHistory();
    expect(history).toHaveLength(LOCATION_HISTORY_LIMIT);
    expect(history[0]).toBe('newest');
    // The oldest entry should have been evicted.
    expect(history).not.toContain(`loc-${LOCATION_HISTORY_LIMIT - 1}`);
  });

  it('is a no-op when recording an empty list', () => {
    recordPlayedLocations(['a']);
    recordPlayedLocations([]);
    expect(readLocationHistory()).toEqual(['a']);
  });

  it('resets history back to empty', () => {
    recordPlayedLocations(['a', 'b']);
    resetLocationHistory();
    expect(readLocationHistory()).toEqual([]);
  });

  it('ignores a payload from a different history version', () => {
    window.localStorage.setItem(
      LOCATION_HISTORY_KEY,
      JSON.stringify({ version: 2, ids: ['a', 'b'] }),
    );
    expect(readLocationHistory()).toEqual([]);
  });

  it('ignores corrupt JSON without throwing', () => {
    window.localStorage.setItem(LOCATION_HISTORY_KEY, '{not json');
    expect(() => readLocationHistory()).not.toThrow();
    expect(readLocationHistory()).toEqual([]);
  });

  it('ignores a malformed ids field (not an array)', () => {
    window.localStorage.setItem(
      LOCATION_HISTORY_KEY,
      JSON.stringify({ version: 1, ids: 'not-an-array' }),
    );
    expect(readLocationHistory()).toEqual([]);
  });

  it('drops non-string / empty entries from a malformed ids array', () => {
    window.localStorage.setItem(
      LOCATION_HISTORY_KEY,
      JSON.stringify({ version: 1, ids: ['a', 42, null, '', 'b', 'a'] }),
    );
    expect(readLocationHistory()).toEqual(['a', 'b']);
  });

  it('recording still works after malformed data was present', () => {
    window.localStorage.setItem(LOCATION_HISTORY_KEY, '{not json');
    recordPlayedLocations(['a']);
    expect(readLocationHistory()).toEqual(['a']);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import { commitRoundStarted, groupIdOf, readDiversityState, resetDiversityState } from './store';
import { LOCATION_HISTORY_KEY, readLocationHistory } from '../utils/locationHistory';
import { SHUFFLE_BAG_KEY, bagKey, readBag } from './bagStorage';
import { HISTORY_LIMIT_GROUPS } from '../config/diversity';

function makeLocations(n: number): GameLocation[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `l-${i}`,
    lat: -80 + (i % 30) * 5,
    lng: -170 + Math.floor(i / 30) * 20,
    label: `l-${i}`,
    country: 'Nowhere',
    difficulty: 'normal' as const,
  }));
}

afterEach(() => {
  window.localStorage.clear();
});

describe('readDiversityState', () => {
  it('returns an empty bag and empty history on a fresh install', () => {
    expect(readDiversityState('normal', 'world')).toEqual({
      bag: { drawn: [], cycle: 0 },
      recentGroupIds: [],
    });
  });

  it('never throws on malformed storage', () => {
    window.localStorage.setItem(SHUFFLE_BAG_KEY, 'nope');
    window.localStorage.setItem(LOCATION_HISTORY_KEY, '[[[');
    expect(() => readDiversityState()).not.toThrow();
    expect(readDiversityState().recentGroupIds).toEqual([]);
  });
});

describe('commitRoundStarted', () => {
  const all = makeLocations(10);

  it('advances the bag and the history together', () => {
    commitRoundStarted({ all, groupId: 'l-0', count: 5, difficulty: 'normal' });
    expect(readBag(bagKey('normal', 'world')).drawn).toEqual(['l-0']);
    expect(readLocationHistory()).toEqual(['l-0']);
  });

  it('puts the newest place at the front of the history', () => {
    commitRoundStarted({ all, groupId: 'l-0', count: 5 });
    commitRoundStarted({ all, groupId: 'l-1', count: 5 });
    expect(readLocationHistory()).toEqual(['l-1', 'l-0']);
  });

  it('ignores an empty group id', () => {
    commitRoundStarted({ all, groupId: '', count: 5 });
    expect(readLocationHistory()).toEqual([]);
  });

  it('writes to the bag for the right difficulty only', () => {
    commitRoundStarted({ all, groupId: 'l-0', count: 5, difficulty: 'hard' });
    expect(readBag(bagKey('hard', 'world')).drawn).toEqual(['l-0']);
    expect(readBag(bagKey('normal', 'world')).drawn).toEqual([]);
  });

  it('wraps the cycle when a place comes round again', () => {
    commitRoundStarted({ all, groupId: 'l-0', count: 5 });
    commitRoundStarted({ all, groupId: 'l-0', count: 5 });
    const bag = readBag(bagKey('normal', 'world'));
    expect(bag.cycle).toBe(1);
    expect(bag.drawn).toEqual(['l-0']);
  });

  it('clears the bag once every place in the pool has been played', () => {
    for (const location of all) {
      commitRoundStarted({ all, groupId: location.id, count: 5 });
    }
    const bag = readBag(bagKey('normal', 'world'));
    expect(bag.drawn).toEqual([]);
    expect(bag.cycle).toBe(1);
    // History still remembers all ten, so novelty ranking survives the wrap.
    expect(readLocationHistory()).toHaveLength(10);
  });

  it('keeps history bounded', () => {
    const many = Array.from({ length: HISTORY_LIMIT_GROUPS + 25 }, (_, i) => `g-${i}`);
    const pool = makeLocations(1);
    for (const groupId of many) commitRoundStarted({ all: pool, groupId, count: 1 });
    expect(readLocationHistory()).toHaveLength(HISTORY_LIMIT_GROUPS);
  });

  it('does not throw when storage is unavailable', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      expect(() => commitRoundStarted({ all, groupId: 'l-0', count: 5 })).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});

describe('groupIdOf', () => {
  it('maps a location id to its canonical group', () => {
    const all = makeLocations(3);
    expect(groupIdOf(all, 'l-1')).toBe('l-1');
  });

  it('falls back to the id itself for a location no longer in the catalog', () => {
    expect(groupIdOf(makeLocations(3), 'retired')).toBe('retired');
  });
});

describe('resetDiversityState', () => {
  it('clears bags and local history', () => {
    const all = makeLocations(5);
    commitRoundStarted({ all, groupId: 'l-0', count: 5 });
    resetDiversityState();
    expect(readLocationHistory()).toEqual([]);
    expect(readBag(bagKey('normal', 'world')).drawn).toEqual([]);
  });
});

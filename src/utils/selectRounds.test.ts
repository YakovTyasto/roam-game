import { describe, it, expect } from 'vitest';
import { selectUniqueLocations, selectUniqueLocationsAvoidingHistory } from './selectRounds';
import type { GameLocation } from '../types';

const makePool = (size: number): GameLocation[] =>
  Array.from({ length: size }, (_, i) => ({
    id: `loc-${i}`,
    lat: i,
    lng: i,
    label: `Location ${i}`,
    country: 'Nowhere',
    difficulty: 'normal',
  }));

describe('selectUniqueLocations', () => {
  it('returns the requested number of locations', () => {
    const result = selectUniqueLocations(makePool(40), 5);
    expect(result).toHaveLength(5);
  });

  it('returns only unique locations', () => {
    const result = selectUniqueLocations(makePool(40), 5);
    const ids = new Set(result.map((l) => l.id));
    expect(ids.size).toBe(5);
  });

  it('does not mutate the input pool', () => {
    const pool = makePool(10);
    const snapshot = pool.map((l) => l.id);
    selectUniqueLocations(pool, 5);
    expect(pool.map((l) => l.id)).toEqual(snapshot);
  });

  it('caps at the pool size when asked for too many', () => {
    const result = selectUniqueLocations(makePool(3), 5);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((l) => l.id)).size).toBe(3);
  });

  it('returns an empty array for a count of 0', () => {
    expect(selectUniqueLocations(makePool(10), 0)).toEqual([]);
  });

  it('is deterministic with a seeded rng', () => {
    const seeded = () => 0; // always pick the first available remaining item
    const a = selectUniqueLocations(makePool(10), 4, seeded);
    const b = selectUniqueLocations(makePool(10), 4, seeded);
    expect(a.map((l) => l.id)).toEqual(b.map((l) => l.id));
  });

  it('every selected location exists in the original pool', () => {
    const pool = makePool(40);
    const ids = new Set(pool.map((l) => l.id));
    const result = selectUniqueLocations(pool, 5);
    for (const loc of result) {
      expect(ids.has(loc.id)).toBe(true);
    }
  });
});

describe('selectUniqueLocationsAvoidingHistory', () => {
  it('never returns duplicate locations within one selection', () => {
    const pool = makePool(40);
    const recentIds = pool.slice(0, 30).map((l) => l.id);
    const result = selectUniqueLocationsAvoidingHistory(pool, 10, recentIds);
    expect(new Set(result.map((l) => l.id)).size).toBe(10);
  });

  it('prefers locations that are not in recent history', () => {
    const pool = makePool(10);
    // Everything except loc-8 and loc-9 is "recently played".
    const recentIds = pool.slice(0, 8).map((l) => l.id);
    const result = selectUniqueLocationsAvoidingHistory(pool, 2, recentIds);
    expect(new Set(result.map((l) => l.id))).toEqual(new Set(['loc-8', 'loc-9']));
  });

  it('falls back to the least-recently-played locations when too few are fresh', () => {
    const pool = makePool(5);
    // All 5 are recent; loc-4 is most recent (index 0), loc-0 is oldest (index 4).
    const recentIds = ['loc-4', 'loc-3', 'loc-2', 'loc-1', 'loc-0'];
    const result = selectUniqueLocationsAvoidingHistory(pool, 2, recentIds);
    // Still reaches the requested count instead of failing.
    expect(result).toHaveLength(2);
    // Picks the two least-recently-played (oldest) entries: loc-0 then loc-1.
    expect(result.map((l) => l.id)).toEqual(['loc-0', 'loc-1']);
  });

  it('mixes fresh and least-recently-played when only partially short', () => {
    const pool = makePool(4); // loc-0..loc-3
    const recentIds = ['loc-1', 'loc-0']; // loc-2, loc-3 are fresh; loc-0 older than loc-1
    const seeded = () => 0;
    const result = selectUniqueLocationsAvoidingHistory(pool, 3, recentIds, seeded);
    expect(result).toHaveLength(3);
    const ids = result.map((l) => l.id);
    // Both fresh locations are included.
    expect(ids).toEqual(expect.arrayContaining(['loc-2', 'loc-3']));
    // The shortfall (1) is filled by the oldest recent entry, loc-0, not loc-1.
    expect(ids).toContain('loc-0');
    expect(ids).not.toContain('loc-1');
  });

  it('returns the full pool reordered when count equals pool size', () => {
    const pool = makePool(6);
    const recentIds = ['loc-5', 'loc-4'];
    const result = selectUniqueLocationsAvoidingHistory(pool, pool.length, recentIds);
    expect(new Set(result.map((l) => l.id))).toEqual(new Set(pool.map((l) => l.id)));
  });

  it('behaves like plain shuffling when history is empty', () => {
    const pool = makePool(10);
    const result = selectUniqueLocationsAvoidingHistory(pool, 5, []);
    expect(result).toHaveLength(5);
    expect(new Set(result.map((l) => l.id)).size).toBe(5);
  });

  it('does not mutate the input pool', () => {
    const pool = makePool(10);
    const snapshot = pool.map((l) => l.id);
    selectUniqueLocationsAvoidingHistory(pool, 5, ['loc-0', 'loc-1']);
    expect(pool.map((l) => l.id)).toEqual(snapshot);
  });

  it('caps at the pool size when asked for too many', () => {
    const pool = makePool(3);
    const result = selectUniqueLocationsAvoidingHistory(pool, 10, []);
    expect(result).toHaveLength(3);
  });
});

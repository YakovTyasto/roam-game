import { describe, it, expect } from 'vitest';
import { selectUniqueLocations } from './selectRounds';
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

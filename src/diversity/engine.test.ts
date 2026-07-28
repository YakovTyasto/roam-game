import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { groupIdsFor, groupIdsForLocationIds, poolGroupKeys, selectRounds } from './engine';
import { EMPTY_BAG } from './shuffleBag';
import { seededRng } from './__fixtures__/rng';
import { LOCATIONS } from '../data/locations';

/**
 * Locations spread across the globe so nothing merges into one canonical group
 * by accident — grouping is tested separately, in canonicalGroup.test.ts.
 */
function makeLocations(
  n: number,
  options: Partial<GameLocation> & { prefix?: string; band?: number } = {},
): GameLocation[] {
  const { prefix = 'l', band = 0, ...overrides } = options;
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    lat: -80 + (i % 30) * 5,
    lng: -170 + band * 40 + Math.floor(i / 30) * 10,
    label: `${prefix}-${i}`,
    country: 'Nowhere',
    continent: 'Europe' as const,
    difficulty: 'normal' as Difficulty,
    ...overrides,
  }));
}

describe('selectRounds — core guarantees', () => {
  const all = makeLocations(20);

  it('returns the requested count with no duplicate places', () => {
    const result = selectRounds({ all, count: 5, rng: seededRng(1) });
    expect(result.locations).toHaveLength(5);
    expect(new Set(result.groupIds).size).toBe(5);
    expect(result.sufficient).toBe(true);
  });

  it('reports insufficiency rather than repeating a place', () => {
    const tiny = makeLocations(3);
    const result = selectRounds({ all: tiny, count: 5, rng: seededRng(1) });
    expect(result.locations).toHaveLength(3);
    expect(result.sufficient).toBe(false);
  });

  it('terminates and returns nothing for an empty catalog', () => {
    const result = selectRounds({ all: [], count: 5, rng: seededRng(1) });
    expect(result.locations).toEqual([]);
    expect(result.sufficient).toBe(false);
    expect(result.poolGroups).toBe(0);
  });

  it('exposes the pool size in canonical groups', () => {
    const twins = [...makeLocations(4), { ...makeLocations(1, { prefix: 'l' })[0], id: 'twin' }];
    // `twin` shares coordinates with `l-0`, so the pool is 4 places, not 5.
    expect(selectRounds({ all: twins, count: 2, rng: seededRng(1) }).poolGroups).toBe(4);
  });
});

describe('selectRounds — bag cycling', () => {
  const all = makeLocations(12);

  it('covers the whole pool before repeating', () => {
    let bag = EMPTY_BAG;
    const seen: string[] = [];
    for (let game = 0; game < 4; game++) {
      const result = selectRounds({ all, count: 3, bag, rng: seededRng(game + 1) });
      seen.push(...result.groupIds);
      bag = result.nextBag;
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('flags the draw that spans a cycle boundary', () => {
    // 12 places, 5 per game: the third game must reach across the boundary.
    let bag = EMPTY_BAG;
    const wrapped: boolean[] = [];
    for (let game = 0; game < 3; game++) {
      const result = selectRounds({ all, count: 5, bag, rng: seededRng(game + 1) });
      wrapped.push(result.startedNewCycle);
      bag = result.nextBag;
    }
    expect(wrapped).toEqual([false, false, true]);
  });

  it('does not flag a draw that merely lands on the boundary', () => {
    // 12 places, 3 per game: the fourth game empties the bag exactly, so the
    // fifth starts a fresh cycle without any single draw spanning a boundary.
    let bag = EMPTY_BAG;
    const wrapped: boolean[] = [];
    for (let game = 0; game < 5; game++) {
      const result = selectRounds({ all, count: 3, bag, rng: seededRng(game + 1) });
      wrapped.push(result.startedNewCycle);
      bag = result.nextBag;
    }
    expect(wrapped).toEqual([false, false, false, false, false]);
    expect(bag.cycle).toBe(1);
  });

  it('keeps the bag bounded by the pool', () => {
    let bag = EMPTY_BAG;
    for (let game = 0; game < 100; game++) {
      bag = selectRounds({ all, count: 5, bag, rng: seededRng(game + 1) }).nextBag;
    }
    expect(bag.drawn.length).toBeLessThanOrEqual(12);
  });
});

describe('selectRounds — difficulty', () => {
  const all = [
    ...makeLocations(8, { prefix: 'e', difficulty: 'easy', band: 0 }),
    ...makeLocations(8, { prefix: 'n', difficulty: 'normal', band: 1 }),
    ...makeLocations(8, { prefix: 'h', difficulty: 'hard', band: 2 }),
  ];

  it('draws only from the requested tier when it is big enough', () => {
    const result = selectRounds({ all, count: 5, difficulty: 'hard', rng: seededRng(1) });
    expect(result.locations.every((l) => l.difficulty === 'hard')).toBe(true);
    expect(result.usedDifficultyFallback).toBe(false);
  });

  it('widens to adjacent tiers only when the tier cannot fill the game', () => {
    const result = selectRounds({ all, count: 12, difficulty: 'easy', rng: seededRng(1) });
    expect(result.usedDifficultyFallback).toBe(true);
    expect(result.locations.some((l) => l.difficulty !== 'easy')).toBe(true);
  });
});

describe('selectRounds — collections', () => {
  const all = [
    ...makeLocations(6, { prefix: 'jp', country: 'Japan', continent: 'Asia', band: 0 }),
    ...makeLocations(6, { prefix: 'fr', country: 'France', continent: 'Europe', band: 2 }),
  ];

  it('treats a collection as a hard filter', () => {
    const result = selectRounds({ all, count: 5, collection: 'asia', rng: seededRng(1) });
    expect(result.locations.every((l) => l.country === 'Japan')).toBe(true);
  });

  it('respects a derived collection', () => {
    // Japan drives on the left; France does not.
    const result = selectRounds({ all, count: 5, collection: 'left-driving', rng: seededRng(1) });
    expect(result.locations.every((l) => l.country === 'Japan')).toBe(true);
  });

  it('reports insufficiency instead of leaking outside the collection', () => {
    const result = selectRounds({ all, count: 10, collection: 'asia', rng: seededRng(1) });
    expect(result.locations.every((l) => l.country === 'Japan')).toBe(true);
    expect(result.sufficient).toBe(false);
  });
});

describe('selectRounds — history and exclusions', () => {
  const all = makeLocations(10);

  it('prefers places missing from a recent history', () => {
    const recent = ['l-0', 'l-1', 'l-2', 'l-3', 'l-4'];
    const result = selectRounds({ all, count: 5, recentGroupIds: recent, rng: seededRng(1) });
    expect(result.groupIds.filter((id) => recent.includes(id))).toHaveLength(0);
  });

  it('falls back to seen places rather than returning a short game', () => {
    const recent = all.map((l) => l.id);
    const result = selectRounds({ all, count: 5, recentGroupIds: recent, rng: seededRng(1) });
    expect(result.locations).toHaveLength(5);
    expect(result.sufficient).toBe(true);
  });

  it('treats malformed history entries as no history at all', () => {
    const junk = ['', 'not-a-location', 'l-0'] as string[];
    const result = selectRounds({ all, count: 5, recentGroupIds: junk, rng: seededRng(1) });
    expect(result.locations).toHaveLength(5);
    expect(new Set(result.groupIds).size).toBe(5);
  });

  it('honours hard exclusions', () => {
    const excluded = ['l-0', 'l-1', 'l-2'];
    const result = selectRounds({
      all,
      count: 7,
      excludeGroupIds: excluded,
      rng: seededRng(1),
    });
    expect(result.groupIds.filter((id) => excluded.includes(id))).toHaveLength(0);
    expect(result.locations).toHaveLength(7);
  });
});

describe('selectRounds — determinism and unpredictability', () => {
  const all = makeLocations(30);

  it('is reproducible for a given seed', () => {
    const a = selectRounds({ all, count: 5, rng: seededRng(11) });
    const b = selectRounds({ all, count: 5, rng: seededRng(11) });
    expect(a.groupIds).toEqual(b.groupIds);
  });

  it('differs between seeds', () => {
    const a = selectRounds({ all, count: 5, rng: seededRng(1) });
    const b = selectRounds({ all, count: 5, rng: seededRng(2) });
    expect(a.groupIds).not.toEqual(b.groupIds);
  });

  it('does not follow sequential catalog ids', () => {
    const result = selectRounds({ all, count: 10, rng: seededRng(3) });
    expect(result.groupIds).not.toEqual(all.slice(0, 10).map((l) => l.id));
    expect(result.groupIds).not.toEqual([...result.groupIds].sort());
  });
});

describe('group id helpers', () => {
  it('maps locations and location ids to the same group ids', () => {
    const picked = LOCATIONS.slice(0, 3);
    expect(groupIdsFor(LOCATIONS, picked)).toEqual(
      groupIdsForLocationIds(
        LOCATIONS,
        picked.map((l) => l.id),
      ),
    );
  });

  it('poolGroupKeys matches the pool the draw used', () => {
    const all = makeLocations(10);
    const keys = poolGroupKeys(all, 5);
    const result = selectRounds({ all, count: 5, rng: seededRng(1) });
    expect(keys.size).toBe(result.poolGroups);
    for (const id of result.groupIds) expect(keys.has(id)).toBe(true);
  });
});

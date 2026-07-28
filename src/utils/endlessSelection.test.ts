import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import { pickNextEndlessLocation, shouldWarnEndlessUsage } from './endlessSelection';

/**
 * Fixtures must be geographically distinct: the Diversity Engine works on
 * canonical groups, so locations sharing coordinates are deliberately treated
 * as one place and would collapse into a single selectable item.
 */
function loc(id: string, index: number): GameLocation {
  return { id, lat: index * 5, lng: index * 7, label: id, country: 'X', difficulty: 'normal' };
}

const rng0 = () => 0;

describe('pickNextEndlessLocation', () => {
  const pool = [loc('a', 0), loc('b', 1), loc('c', 2)];

  it('avoids groups already used this session while any remain', () => {
    const used = new Set(['a']);
    const picked = pickNextEndlessLocation(pool, 'normal', used, [], rng0);
    expect(picked).not.toBeNull();
    expect(used.has(picked!.id)).toBe(false);
  });

  it('never repeats until every location in the pool has been used', () => {
    const used = new Set<string>();
    const seen = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      const picked = pickNextEndlessLocation(pool, 'normal', used, [], () => i / pool.length);
      expect(picked).not.toBeNull();
      expect(seen.has(picked!.id)).toBe(false);
      seen.add(picked!.id);
      used.add(picked!.id);
    }
    expect(seen.size).toBe(pool.length);
  });

  it('falls back to allowing repeats once the pool is exhausted', () => {
    const used = new Set(['a', 'b', 'c']);
    const picked = pickNextEndlessLocation(pool, 'normal', used, [], rng0);
    expect(picked).not.toBeNull();
    expect(pool.map((l) => l.id)).toContain(picked!.id);
  });

  it('treats two rows for one place as a single session entry', () => {
    // Same coordinates → one canonical group. Excluding either excludes both.
    const twins = [
      { ...loc('view-north', 3), id: 'view-north' },
      { ...loc('view-north', 3), id: 'view-south' },
      loc('elsewhere', 9),
    ];
    const picked = pickNextEndlessLocation(twins, 'normal', new Set(['view-north']), [], rng0);
    expect(picked?.id).toBe('elsewhere');
  });

  it('returns null for an empty pool', () => {
    expect(pickNextEndlessLocation([], 'normal', new Set(), [], rng0)).toBeNull();
  });
});

describe('shouldWarnEndlessUsage', () => {
  it('fires every 25 rounds', () => {
    expect(shouldWarnEndlessUsage(25)).toBe(true);
    expect(shouldWarnEndlessUsage(50)).toBe(true);
    expect(shouldWarnEndlessUsage(24)).toBe(false);
    expect(shouldWarnEndlessUsage(26)).toBe(false);
    expect(shouldWarnEndlessUsage(0)).toBe(false);
  });
});

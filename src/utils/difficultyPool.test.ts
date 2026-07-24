import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DIFFICULTIES } from '../config/difficulty';
import { APP } from '../config/app';
import { LOCATIONS } from '../data/locations';
import { buildDifficultyPool, locationsForDifficulty } from './difficultyPool';

function loc(id: string, difficulty: Difficulty): GameLocation {
  return { id, lat: 0, lng: 0, label: id, country: 'Nowhere', difficulty };
}

describe('difficulty pools over the real dataset', () => {
  it('gives every preset enough unique locations for a five-round game', () => {
    for (const d of DIFFICULTIES) {
      const pool = locationsForDifficulty(LOCATIONS, d);
      expect(pool.length).toBeGreaterThanOrEqual(APP.roundsPerGame);
      // Ids must be unique within a tier.
      expect(new Set(pool.map((l) => l.id)).size).toBe(pool.length);
    }
  });

  it('preserves country diversity within each preset', () => {
    for (const d of DIFFICULTIES) {
      const pool = locationsForDifficulty(LOCATIONS, d);
      const countries = new Set(pool.map((l) => l.country));
      // At least a handful of distinct countries per tier.
      expect(countries.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('does not use the identical set for every difficulty', () => {
    const easy = new Set(locationsForDifficulty(LOCATIONS, 'easy').map((l) => l.id));
    const hard = new Set(locationsForDifficulty(LOCATIONS, 'hard').map((l) => l.id));
    // No overlap between easy and hard tiers.
    for (const id of easy) expect(hard.has(id)).toBe(false);
  });

  it('reports each real preset pool as sufficient with no fallback', () => {
    for (const d of DIFFICULTIES) {
      const result = buildDifficultyPool(LOCATIONS, d, APP.roundsPerGame);
      expect(result.sufficient).toBe(true);
      expect(result.usedFallback).toBe(false);
    }
  });
});

describe('adjacent-pool fallback', () => {
  it('widens into adjacent tiers when the primary tier is too small', () => {
    const pool: GameLocation[] = [
      loc('e1', 'easy'),
      loc('e2', 'easy'),
      loc('n1', 'normal'),
      loc('n2', 'normal'),
      loc('n3', 'normal'),
      loc('h1', 'hard'),
    ];
    const result = buildDifficultyPool(pool, 'easy', 5);
    expect(result.usedFallback).toBe(true);
    expect(result.sufficient).toBe(true);
    expect(result.locations.length).toBeGreaterThanOrEqual(5);
    // The two easy locations come first (primary tier priority).
    expect(result.locations.slice(0, 2).map((l) => l.id)).toEqual(['e1', 'e2']);
    // No duplicate ids after widening.
    expect(new Set(result.locations.map((l) => l.id)).size).toBe(
      result.locations.length,
    );
  });

  it('flags an insufficient pool rather than silently failing', () => {
    const pool: GameLocation[] = [loc('e1', 'easy'), loc('e2', 'easy')];
    const result = buildDifficultyPool(pool, 'easy', 5);
    expect(result.sufficient).toBe(false);
    expect(result.locations.length).toBe(2);
  });

  it('does not widen when the primary tier already suffices', () => {
    const pool: GameLocation[] = [
      loc('h1', 'hard'),
      loc('h2', 'hard'),
      loc('h3', 'hard'),
      loc('n1', 'normal'),
    ];
    const result = buildDifficultyPool(pool, 'hard', 3);
    expect(result.usedFallback).toBe(false);
    expect(result.locations.map((l) => l.id)).toEqual(['h1', 'h2', 'h3']);
  });
});

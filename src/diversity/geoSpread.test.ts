import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import type { Continent } from '../config/geography';
import { describeSpread, maxPerContinent, spreadGeography } from './geoSpread';
import { selectRounds } from './engine';
import { seededRng } from './__fixtures__/rng';
import { LOCATIONS } from '../data/locations';
import { CANONICAL_THRESHOLDS } from '../utils/canonicalGroup';

function loc(
  id: string,
  country: string,
  continent: Continent,
  lat: number,
  lng: number,
): GameLocation {
  return { id, lat, lng, label: id, country, continent, difficulty: 'normal' };
}

describe('maxPerContinent', () => {
  it('allows two per continent for short games and scales up for long ones', () => {
    expect(maxPerContinent(3)).toBe(2);
    expect(maxPerContinent(5)).toBe(2);
    expect(maxPerContinent(10)).toBe(4);
    expect(maxPerContinent(20)).toBe(7);
  });
});

describe('spreadGeography — permutation safety', () => {
  const ranked = [
    loc('a', 'France', 'Europe', 48, 2),
    loc('b', 'France', 'Europe', 44, 5),
    loc('c', 'Japan', 'Asia', 35, 139),
    loc('d', 'Brazil', 'South America', -22, -43),
  ];

  it('returns a permutation of the input', () => {
    const out = spreadGeography(ranked, 3);
    expect(out).toHaveLength(ranked.length);
    expect(out.map((l) => l.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not mutate the input', () => {
    const copy = ranked.map((l) => l.id);
    spreadGeography(ranked, 3);
    expect(ranked.map((l) => l.id)).toEqual(copy);
  });

  it('handles trivial counts', () => {
    expect(spreadGeography(ranked, 0).map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(spreadGeography(ranked, 1).map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(spreadGeography([], 5)).toEqual([]);
  });
});

describe('spreadGeography — soft rules', () => {
  it('avoids two consecutive rounds in the same country', () => {
    const ranked = [
      loc('fr-1', 'France', 'Europe', 48, 2),
      loc('fr-2', 'France', 'Europe', 44, 5),
      loc('jp', 'Japan', 'Asia', 35, 139),
    ];
    const picked = spreadGeography(ranked, 3).slice(0, 3);
    expect(describeSpread(picked).consecutiveSameCountry).toBe(0);
  });

  it('avoids two rounds in the same metro cluster', () => {
    const ranked = [
      loc('london-a', 'United Kingdom', 'Europe', 51.5007, -0.1246),
      loc('london-b', 'United Kingdom', 'Europe', 51.5074, -0.0278), // ~6.7 km
      loc('tokyo', 'Japan', 'Asia', 35.6595, 139.7005),
      loc('rio', 'Brazil', 'South America', -22.97, -43.18),
    ];
    const picked = spreadGeography(ranked, 3).slice(0, 3);
    expect(describeSpread(picked).sameClusterPairs).toBe(0);
  });

  it('caps how many rounds come from one continent when the pool allows', () => {
    // Europe leads the ranking but there is enough elsewhere to honour the cap.
    const ranked = [
      loc('eu-1', 'France', 'Europe', 48, 2),
      loc('eu-2', 'Italy', 'Europe', 41, 12),
      loc('eu-3', 'Spain', 'Europe', 40, -3),
      loc('eu-4', 'Germany', 'Europe', 52, 13),
      loc('as-1', 'Japan', 'Asia', 35, 139),
      loc('as-2', 'India', 'Asia', 28, 77),
      loc('sa-1', 'Brazil', 'South America', -22, -43),
      loc('sa-2', 'Chile', 'South America', -33, -70),
    ];
    const picked = spreadGeography(ranked, 5).slice(0, 5);
    expect(describeSpread(picked).maxPerContinent).toBeLessThanOrEqual(maxPerContinent(5));
    expect(describeSpread(picked).continents).toBeGreaterThanOrEqual(3);
  });

  it('exceeds the continent cap only as far as the pool forces it', () => {
    // Four European candidates but only one each from Asia and South America:
    // a five-round game must relax the cap by exactly one.
    const ranked = [
      loc('eu-1', 'France', 'Europe', 48, 2),
      loc('eu-2', 'Italy', 'Europe', 41, 12),
      loc('eu-3', 'Spain', 'Europe', 40, -3),
      loc('eu-4', 'Germany', 'Europe', 52, 13),
      loc('as-1', 'Japan', 'Asia', 35, 139),
      loc('sa-1', 'Brazil', 'South America', -22, -43),
    ];
    const report = describeSpread(spreadGeography(ranked, 5).slice(0, 5));
    expect(report.maxPerContinent).toBe(maxPerContinent(5) + 1);
    expect(report.continents).toBe(3);
    expect(report.consecutiveSameCountry).toBe(0);
  });

  it('prefers the freshest candidate that satisfies the rules', () => {
    // `jp` is ranked last but is the only candidate that breaks the run of
    // French locations, so it must come second — not first.
    const ranked = [
      loc('fr-1', 'France', 'Europe', 48, 2),
      loc('fr-2', 'France', 'Europe', 44, 5),
      loc('jp', 'Japan', 'Asia', 35, 139),
    ];
    expect(spreadGeography(ranked, 3).map((l) => l.id)).toEqual(['fr-1', 'jp', 'fr-2']);
  });
});

describe('spreadGeography — relaxation and termination', () => {
  it('still fills every slot when the rules cannot all be met', () => {
    // One country, one cluster, one continent: every rule must relax away.
    const ranked = Array.from({ length: 5 }, (_, i) =>
      loc(`x${i}`, 'France', 'Europe', 48.85 + i * 0.01, 2.29),
    );
    const out = spreadGeography(ranked, 5);
    expect(out).toHaveLength(5);
    expect(out.map((l) => l.id).sort()).toEqual(['x0', 'x1', 'x2', 'x3', 'x4']);
  });

  it('terminates for a themed collection that cannot spread continents', () => {
    const europeOnly = [
      loc('fr', 'France', 'Europe', 48, 2),
      loc('it', 'Italy', 'Europe', 41, 12),
      loc('es', 'Spain', 'Europe', 40, -3),
      loc('de', 'Germany', 'Europe', 52, 13),
      loc('se', 'Sweden', 'Europe', 59, 18),
    ];
    const picked = spreadGeography(europeOnly, 5).slice(0, 5);
    expect(picked).toHaveLength(5);
    // The collection is respected even though continent spread is impossible.
    expect(picked.every((l) => l.continent === 'Europe')).toBe(true);
    // The weaker rules still hold: five different countries, no shared cluster.
    expect(describeSpread(picked).consecutiveSameCountry).toBe(0);
    expect(describeSpread(picked).sameClusterPairs).toBe(0);
  });

  it('handles locations with no continent metadata', () => {
    const ranked = [
      { ...loc('a', 'Atlantis', 'Europe', 10, 10), continent: undefined },
      { ...loc('b', 'Atlantis', 'Europe', 40, 40), continent: undefined },
      loc('c', 'Japan', 'Asia', 35, 139),
    ];
    const out = spreadGeography(ranked, 3);
    expect(out).toHaveLength(3);
  });
});

describe('spread inside the engine', () => {
  it('is applied by default to real catalog selections', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const result = selectRounds({ all: LOCATIONS, count: 5, rng: seededRng(seed) });
      const report = describeSpread(result.locations, CANONICAL_THRESHOLDS);
      expect(report.consecutiveSameCountry).toBe(0);
      expect(report.sameClusterPairs).toBe(0);
      expect(report.maxPerContinent).toBeLessThanOrEqual(maxPerContinent(5));
    }
  });

  it('reaches at least three continents in a standard game', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const result = selectRounds({ all: LOCATIONS, count: 5, rng: seededRng(seed) });
      expect(describeSpread(result.locations).continents).toBeGreaterThanOrEqual(3);
    }
  });

  it('can be disabled without changing which places are eligible', () => {
    const on = selectRounds({ all: LOCATIONS, count: 5, rng: seededRng(9) });
    const off = selectRounds({ all: LOCATIONS, count: 5, rng: seededRng(9), spread: false });
    expect(on.poolGroups).toBe(off.poolGroups);
    expect(on.locations).toHaveLength(off.locations.length);
  });

  it('never breaks uniqueness in the pursuit of spread', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const result = selectRounds({ all: LOCATIONS, count: 10, rng: seededRng(seed) });
      expect(new Set(result.groupIds).size).toBe(result.groupIds.length);
    }
  });

  it('never breaks the difficulty guarantee in the pursuit of spread', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = selectRounds({
        all: LOCATIONS,
        count: 5,
        difficulty: 'hard',
        rng: seededRng(seed),
      });
      // The hard tier alone can supply 5, so no fallback is expected.
      expect(result.usedDifficultyFallback).toBe(false);
      expect(result.locations.every((l) => l.difficulty === 'hard')).toBe(true);
    }
  });
});

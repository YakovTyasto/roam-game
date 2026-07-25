import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import { LOCATIONS } from '../data/locations';
import { auditDataset, representedContinents } from './datasetAudit';
import { formatAuditMarkdown } from './formatAudit';
import { COUNTRY_CONTINENT, continentForCountry } from '../config/geography';
import { CURATED_TAGS } from '../config/collections';
import { STANDARD_ROUND_COUNT, TARGET_FRESH_GAMES } from '../config/diversity';

function loc(overrides: Partial<GameLocation> & { id: string }): GameLocation {
  return {
    lat: 0,
    lng: 0,
    label: overrides.id,
    country: 'France',
    continent: 'Europe',
    difficulty: 'normal',
    ...overrides,
  };
}

describe('auditDataset — counting', () => {
  it('counts locations, groups, countries and continents', () => {
    const report = auditDataset([
      loc({ id: 'a', lat: 48.85, lng: 2.29 }),
      loc({ id: 'b', lat: 48.851, lng: 2.29 }), // ~0.11 km → same group as a
      loc({ id: 'c', lat: 35.65, lng: 139.7, country: 'Japan', continent: 'Asia' }),
    ]);
    expect(report.totals.locations).toBe(3);
    expect(report.totals.canonicalGroups).toBe(2);
    expect(report.totals.redundantLocations).toBe(1);
    expect(report.totals.countries).toBe(2);
    expect(report.totals.continents).toBe(2);
  });

  it('reports groups (not rows) in every distribution bucket', () => {
    const report = auditDataset([
      loc({ id: 'a', lat: 48.85, lng: 2.29 }),
      loc({ id: 'b', lat: 48.851, lng: 2.29 }),
    ]);
    const france = report.byCountry.find((b) => b.key === 'France');
    expect(france).toEqual({ key: 'France', locations: 2, groups: 1 });
  });
});

describe('auditDataset — duplicate detection', () => {
  it('finds duplicate location ids', () => {
    const report = auditDataset([loc({ id: 'dup' }), loc({ id: 'dup', lat: 40, lng: 40 })]);
    expect(report.duplicates.duplicateLocationIds).toEqual(['dup']);
    expect(report.ok).toBe(false);
  });

  it('finds duplicate pano ids', () => {
    const report = auditDataset([
      loc({ id: 'a', lat: 10, lng: 10, panoId: 'P1' }),
      loc({ id: 'b', lat: 50, lng: 50, panoId: 'P1' }),
    ]);
    expect(report.duplicates.duplicatePanoIds).toEqual([
      { panoId: 'P1', locationIds: ['a', 'b'] },
    ]);
  });

  it('separates identical coordinates from near-duplicates', () => {
    const report = auditDataset([
      loc({ id: 'same-1', lat: 10, lng: 10 }),
      loc({ id: 'same-2', lat: 10, lng: 10 }),
      loc({ id: 'near', lat: 10.004, lng: 10 }), // ~0.44 km
      loc({ id: 'far', lat: 40, lng: 40 }),
    ]);
    const ids = (pairs: { a: string; b: string }[]) =>
      pairs.map((p) => [p.a, p.b].sort().join('+')).sort();
    expect(ids(report.duplicates.identicalCoordinates)).toEqual(['same-1+same-2']);
    expect(ids(report.duplicates.nearDuplicateCoordinates)).toEqual([
      'near+same-1',
      'near+same-2',
    ]);
  });

  it('reports explicit location groups', () => {
    const report = auditDataset([
      loc({ id: 'a', lat: 10, lng: 10, locationGroupId: 'g' }),
      loc({ id: 'b', lat: 50, lng: 50, locationGroupId: 'g' }),
    ]);
    expect(report.duplicates.explicitGroups).toEqual([
      { groupId: 'g', locationIds: ['a', 'b'] },
    ]);
  });

  it('reports small geographic clusters without merging them', () => {
    const report = auditDataset([
      loc({ id: 'metro-a', lat: 51.5007, lng: -0.1246 }),
      loc({ id: 'metro-b', lat: 51.5074, lng: -0.0278 }), // ~6.7 km
      loc({ id: 'elsewhere', lat: -20, lng: 100, country: 'Australia', continent: 'Oceania' }),
    ]);
    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0].members).toEqual(['metro-a', 'metro-b']);
    expect(report.clusters[0].spanKm).toBeGreaterThan(5);
    // Clusters never reduce the group count.
    expect(report.totals.canonicalGroups).toBe(3);
  });
});

describe('auditDataset — metadata validation', () => {
  it('flags invalid coordinates and excludes them from grouping', () => {
    const report = auditDataset([
      loc({ id: 'bad', lat: 999, lng: 0 }),
      loc({ id: 'good', lat: 10, lng: 10 }),
    ]);
    expect(report.metadataIssues.some((i) => i.locationId === 'bad' && i.field === 'coordinates')).toBe(true);
    expect(report.totals.canonicalGroups).toBe(1);
    expect(report.ok).toBe(false);
  });

  it('flags missing label and country', () => {
    const report = auditDataset([loc({ id: 'x', label: '', country: '' })]);
    const fields = report.metadataIssues.map((i) => i.field);
    expect(fields).toContain('label');
    expect(fields).toContain('country');
  });

  it('flags a country missing from COUNTRY_CONTINENT', () => {
    const report = auditDataset([loc({ id: 'x', country: 'Atlantis', continent: 'Europe' })]);
    expect(
      report.metadataIssues.some((i) => i.field === 'country' && i.message.includes('COUNTRY_CONTINENT')),
    ).toBe(true);
  });

  it('flags a continent that disagrees with the country table', () => {
    const report = auditDataset([loc({ id: 'x', country: 'Japan', continent: 'Europe' })]);
    expect(
      report.metadataIssues.some((i) => i.field === 'continent' && i.message.includes('disagrees')),
    ).toBe(true);
  });

  it('flags missing continent metadata', () => {
    const { continent: _omitted, ...rest } = loc({ id: 'x' });
    const report = auditDataset([rest as GameLocation]);
    expect(report.metadataIssues.some((i) => i.field === 'continent')).toBe(true);
  });

  it('flags an invalid difficulty', () => {
    const report = auditDataset([
      { ...loc({ id: 'x' }), difficulty: 'impossible' as unknown as GameLocation['difficulty'] },
    ]);
    expect(report.metadataIssues.some((i) => i.field === 'difficulty')).toBe(true);
  });
});

describe('auditDataset — pool sufficiency', () => {
  // Spread far enough apart that nothing merges or clusters, and give each
  // difficulty its own longitude band so tiers never overlap geographically.
  const bands: Record<GameLocation['difficulty'], number> = { easy: 0, normal: 60, hard: 120 };
  const many = (n: number, prefix: string, difficulty: GameLocation['difficulty']) =>
    Array.from({ length: n }, (_, i) =>
      loc({
        id: `${prefix}-${i}`,
        lat: -80 + (i % 40) * 4,
        lng: -170 + bands[difficulty] + Math.floor(i / 40) * 20,
        difficulty,
      }),
    );

  it('marks a tiny pool unplayable and quantifies the shortfall', () => {
    const report = auditDataset(many(4, 'n', 'normal'));
    const normal = report.byDifficulty.find((d) => d.difficulty === 'normal')!;
    const five = normal.sufficiency.find((s) => s.roundCount === 5)!;
    expect(five.playable).toBe(false);
    expect(five.comfortable).toBe(false);
    expect(five.shortfall).toBe(5 * TARGET_FRESH_GAMES - 4);
  });

  it('marks a large pool comfortable with no shortfall', () => {
    const report = auditDataset(many(60, 'n', 'normal'));
    const five = report.byDifficulty
      .find((d) => d.difficulty === 'normal')!
      .sufficiency.find((s) => s.roundCount === 5)!;
    expect(five.comfortable).toBe(true);
    expect(five.shortfall).toBe(0);
  });

  it('reports when adjacent-difficulty fallback was needed', () => {
    const report = auditDataset([...many(2, 'e', 'easy'), ...many(30, 'n', 'normal')]);
    const easyTen = report.byDifficulty
      .find((d) => d.difficulty === 'easy')!
      .sufficiency.find((s) => s.roundCount === 10)!;
    expect(easyTen.usedFallback).toBe(true);
    expect(easyTen.groups).toBeGreaterThan(2);
  });

  it('bases the verdict on the default pool, not the whole catalog', () => {
    // 40 easy + 5 normal: the catalog looks big, a default (normal) game is not.
    const report = auditDataset([...many(40, 'e', 'easy'), ...many(5, 'n', 'normal')]);
    expect(report.verdict.catalogGroups).toBe(45);
    expect(report.verdict.defaultPoolGroups).toBe(5);
    expect(report.verdict.freshGamesSupported).toBe(1);
    expect(report.verdict.sufficient).toBe(false);
  });
});

describe('auditDataset — collections', () => {
  it('marks a collection with too few groups as unshippable', () => {
    const report = auditDataset([
      loc({ id: 'a', lat: 10, lng: 10, tags: ['rural'] }),
      loc({ id: 'b', lat: 20, lng: 20, tags: ['rural'] }),
    ]);
    const rural = report.byCollection.find((c) => c.collection === 'rural')!;
    expect(rural.groups).toBe(2);
    expect(rural.shippable).toBe(false);
  });

  it('derives continent and left-driving collections from country metadata', () => {
    const report = auditDataset([
      loc({ id: 'jp', lat: 35.65, lng: 139.7, country: 'Japan', continent: 'Asia' }),
      loc({ id: 'fr', lat: 48.85, lng: 2.29 }),
    ]);
    expect(report.byCollection.find((c) => c.collection === 'asia')!.locations).toBe(1);
    expect(report.byCollection.find((c) => c.collection === 'europe')!.locations).toBe(1);
    expect(report.byCollection.find((c) => c.collection === 'left-driving')!.locations).toBe(1);
    expect(report.byCollection.find((c) => c.collection === 'islands')!.locations).toBe(1);
  });
});

describe('the shipped catalog', () => {
  const report = auditDataset(LOCATIONS);

  it('has no metadata issues and no duplicate ids', () => {
    expect(report.metadataIssues).toEqual([]);
    expect(report.duplicates.duplicateLocationIds).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('contains no duplicate, identical or near-duplicate places', () => {
    expect(report.duplicates.duplicatePanoIds).toEqual([]);
    expect(report.duplicates.identicalCoordinates).toEqual([]);
    expect(report.duplicates.nearDuplicateCoordinates).toEqual([]);
    expect(report.totals.redundantLocations).toBe(0);
  });

  it('gives every country a continent mapping', () => {
    for (const location of LOCATIONS) {
      expect(continentForCountry(location.country), `${location.country} missing`).not.toBeNull();
      expect(location.continent).toBe(COUNTRY_CONTINENT[location.country]);
    }
  });

  it('only uses curated tags on catalog entries', () => {
    for (const location of LOCATIONS) {
      for (const tag of location.tags) {
        expect(CURATED_TAGS).toContain(tag);
      }
    }
  });

  it('is honest about being too small for the freshness target', () => {
    // This is the headline diagnosis: the catalog is NOT duplicated, it is
    // simply too small. If a future catalog expansion fixes it, this test
    // should be updated deliberately — not silently.
    expect(report.verdict.sufficient).toBe(false);
    expect(report.verdict.defaultPoolGroups).toBeLessThan(
      STANDARD_ROUND_COUNT * TARGET_FRESH_GAMES,
    );
  });

  it('represents at least five continents', () => {
    expect(representedContinents(LOCATIONS).length).toBeGreaterThanOrEqual(5);
  });
});

describe('formatAuditMarkdown', () => {
  const markdown = formatAuditMarkdown(auditDataset(LOCATIONS));

  it('renders every required section', () => {
    for (const heading of [
      '## Verdict',
      '## Totals',
      '## By difficulty',
      '### Required catalog growth',
      '## By continent',
      '## By country',
      '## By collection',
      '## Duplicates and near-duplicates',
      '## Small geographic clusters',
      '## Metadata issues',
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  it('states the shortfall rather than claiming the catalog is fine', () => {
    expect(markdown).toContain('Shortfall:');
  });

  it('renders an empty table body instead of a broken table', () => {
    expect(formatAuditMarkdown(auditDataset([]))).toContain('| _none_ |');
  });
});

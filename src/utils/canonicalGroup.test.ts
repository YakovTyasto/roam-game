import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import {
  CANONICAL_THRESHOLDS,
  buildCanonicalGroups,
  buildGroupIndex,
  groupByProximity,
  groupIdFor,
  hasIdenticalCoordinates,
  isSameCluster,
} from './canonicalGroup';
import { LOCATIONS } from '../data/locations';

function loc(overrides: Partial<GameLocation> & { id: string }): GameLocation {
  return {
    lat: 0,
    lng: 0,
    label: overrides.id,
    country: 'Testland',
    difficulty: 'normal',
    ...overrides,
  };
}

describe('canonical grouping', () => {
  it('treats genuinely distinct places as their own group', () => {
    const groups = buildCanonicalGroups([
      loc({ id: 'a', lat: 10, lng: 10 }),
      loc({ id: 'b', lat: 20, lng: 20 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.reason === 'single')).toBe(true);
  });

  it('merges entries sharing an explicit locationGroupId', () => {
    const groups = buildCanonicalGroups([
      loc({ id: 'north-view', lat: 10, lng: 10, locationGroupId: 'landmark-x' }),
      loc({ id: 'south-view', lat: 40, lng: 40, locationGroupId: 'landmark-x' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('landmark-x');
    expect(groups[0].reason).toBe('explicit');
  });

  it('merges entries resolving to the same panorama', () => {
    const groups = buildCanonicalGroups([
      loc({ id: 'a', lat: 10, lng: 10, panoId: 'PANO_1' }),
      loc({ id: 'b', lat: 60, lng: 60, panoId: 'PANO_1' }),
      loc({ id: 'c', lat: -20, lng: 5, panoId: 'PANO_2' }),
    ]);
    expect(groups).toHaveLength(2);
    const merged = groups.find((g) => g.locations.length === 2);
    expect(merged?.reason).toBe('pano');
    expect(merged?.id).toBe('a');
  });

  it('merges entries within the near-duplicate radius', () => {
    // ~0.3 km apart — same square, different corner.
    const groups = buildCanonicalGroups([
      loc({ id: 'square-north', lat: 48.8584, lng: 2.2945 }),
      loc({ id: 'square-south', lat: 48.8557, lng: 2.2945 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('proximity');
  });

  it('does NOT merge different districts of one city', () => {
    // Shibuya and Gion are both "Japan" but ~370 km apart; two districts of a
    // single city are still far beyond the sub-kilometre threshold.
    const groups = buildCanonicalGroups([
      loc({ id: 'city-centre', lat: 51.5007, lng: -0.1246 }),
      loc({ id: 'city-east', lat: 51.5074, lng: -0.0278 }), // ~6.7 km away
    ]);
    expect(groups).toHaveLength(2);
  });

  it('links proximity transitively', () => {
    // A–B and B–C are each inside the radius; A–C is not, but all three are
    // one place.
    const groups = buildCanonicalGroups([
      loc({ id: 'a', lat: 0, lng: 0 }),
      loc({ id: 'b', lat: 0, lng: 0.008 }), // ~0.89 km from a
      loc({ id: 'c', lat: 0, lng: 0.016 }), // ~0.89 km from b, ~1.78 km from a
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].locations.map((l) => l.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('merges across rules without producing overlapping groups', () => {
    const groups = buildCanonicalGroups([
      loc({ id: 'a', lat: 0, lng: 0, locationGroupId: 'g1' }),
      loc({ id: 'b', lat: 30, lng: 30, locationGroupId: 'g1' }),
      loc({ id: 'c', lat: 30.001, lng: 30 }), // proximity-linked to b
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].locations).toHaveLength(3);
    expect(groups[0].id).toBe('g1');
  });

  it('is deterministic and order-independent', () => {
    const input = [
      loc({ id: 'c', lat: 5, lng: 5 }),
      loc({ id: 'a', lat: 0, lng: 0 }),
      loc({ id: 'b', lat: 0, lng: 0.002 }),
    ];
    const forward = buildCanonicalGroups(input).map((g) => g.id);
    const reversed = buildCanonicalGroups([...input].reverse()).map((g) => g.id);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual([...forward].sort());
  });

  it('names a derived group after its lexicographically smallest member', () => {
    const groups = buildCanonicalGroups([
      loc({ id: 'zulu', lat: 0, lng: 0 }),
      loc({ id: 'alpha', lat: 0, lng: 0.001 }),
    ]);
    expect(groups[0].id).toBe('alpha');
  });

  it('handles an empty catalog', () => {
    expect(buildCanonicalGroups([])).toEqual([]);
  });
});

describe('buildGroupIndex / groupIdFor', () => {
  it('maps every location id to its group id', () => {
    const index = buildGroupIndex([
      loc({ id: 'a', lat: 0, lng: 0 }),
      loc({ id: 'b', lat: 0, lng: 0.001 }),
      loc({ id: 'c', lat: 40, lng: 40 }),
    ]);
    expect(index.get('a')).toBe('a');
    expect(index.get('b')).toBe('a');
    expect(index.get('c')).toBe('c');
  });

  it('falls back to the location id for unknown (legacy) locations', () => {
    const index = buildGroupIndex([loc({ id: 'a' })]);
    expect(groupIdFor(index, 'retired-location')).toBe('retired-location');
  });
});

describe('cluster and coordinate helpers', () => {
  it('flags coordinates inside the same metro area as one cluster', () => {
    const a = loc({ id: 'a', lat: 51.5007, lng: -0.1246 });
    const b = loc({ id: 'b', lat: 51.5074, lng: -0.0278 }); // ~6.7 km
    expect(isSameCluster(a, b)).toBe(true);
    // …but they remain distinct canonical places.
    expect(buildCanonicalGroups([a, b])).toHaveLength(2);
  });

  it('does not treat far-apart locations as one cluster', () => {
    expect(
      isSameCluster(loc({ id: 'a', lat: 0, lng: 0 }), loc({ id: 'b', lat: 1, lng: 1 })),
    ).toBe(false);
  });

  it('detects identical coordinates within the audit precision', () => {
    const a = loc({ id: 'a', lat: 12.3456789, lng: 98.7654321 });
    const b = loc({ id: 'b', lat: 12.3456789, lng: 98.7654321 });
    expect(hasIdenticalCoordinates(a, b)).toBe(true);
    expect(hasIdenticalCoordinates(a, loc({ id: 'c', lat: 12.35, lng: 98.77 }))).toBe(false);
  });

  it('groupByProximity respects the supplied radius', () => {
    const items = [
      loc({ id: 'a', lat: 0, lng: 0 }),
      loc({ id: 'b', lat: 0, lng: 0.05 }), // ~5.6 km
    ];
    expect(groupByProximity(items, 1)).toHaveLength(2);
    expect(groupByProximity(items, 25)).toHaveLength(1);
  });
});

describe('the shipped catalog', () => {
  it('contains no accidental duplicates — every row is its own place', () => {
    const groups = buildCanonicalGroups(LOCATIONS);
    expect(groups).toHaveLength(LOCATIONS.length);
  });

  it('uses the documented thresholds', () => {
    expect(CANONICAL_THRESHOLDS).toEqual({
      identicalCoordinateDegrees: 1e-5,
      nearDuplicateKm: 1,
      clusterKm: 25,
    });
  });
});

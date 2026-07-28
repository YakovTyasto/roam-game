/**
 * Canonical location grouping — the answer to "have I already seen this
 * place?".
 *
 * The V3 cooldown keyed on `location.id`, which quietly assumed that different
 * ids mean different places. They don't: two catalog entries can point at the
 * same panorama, sit 200 m apart on the same square, or be two deliberate
 * viewpoints of one landmark. To a player those are the *same location*, so
 * treating them as distinct made the cooldown weaker than it looked.
 *
 * The Diversity Engine therefore operates on **canonical groups**, not ids. A
 * group is derived in a strict precedence order:
 *
 *   1. `locationGroupId` — an explicit, human-reviewed statement that entries
 *      belong together (two viewpoints of one landmark). Always wins.
 *   2. `panoId` — the exact same Street View panorama is, by definition, the
 *      same place.
 *   3. Geographic proximity — entries within `nearDuplicateKm` of each other,
 *      linked transitively, are one place.
 *
 * Deliberately NOT used: city or country. Two different neighbourhoods of one
 * city are genuinely different places to guess, and collapsing them would
 * shrink the pool far more than it would improve variety. `nearDuplicateKm` is
 * small (sub-kilometre) for exactly that reason.
 *
 * A second, coarser notion — `clusterKm` — exists only for the *soft* in-match
 * diversity rule ("don't put two rounds from the same metro area in one game").
 * It never merges groups and never affects uniqueness.
 *
 * All grouping is deterministic: the same catalog always produces the same
 * group ids, in the same order, with no dependence on RNG or insertion order.
 */

import type { GameLocation } from '../types';
import { haversineDistanceKm } from './distance';

/**
 * Distance/precision thresholds. Typed and exported so tests can assert against
 * the exact values, and so a future tuning change is a one-line, reviewable
 * edit rather than a magic number buried in a loop.
 */
export interface CanonicalThresholds {
  /**
   * Coordinates differing by less than this (in decimal degrees, on both axes)
   * are reported as *identical* by the audit. ~1e-5° ≈ 1.1 m at the equator.
   */
  identicalCoordinateDegrees: number;
  /**
   * Entries within this great-circle distance are the same canonical place.
   * Sub-kilometre on purpose: it catches "same square, different corner"
   * without collapsing distinct districts of one city.
   */
  nearDuplicateKm: number;
  /**
   * Entries within this distance belong to the same *small geographic
   * cluster* (roughly one metropolitan area). Used ONLY by the soft in-match
   * diversity rule — never for uniqueness.
   */
  clusterKm: number;
}

export const CANONICAL_THRESHOLDS: Readonly<CanonicalThresholds> = {
  identicalCoordinateDegrees: 1e-5,
  nearDuplicateKm: 1,
  clusterKm: 25,
};

/** A canonical group: one "place" that may be backed by several catalog rows. */
export interface CanonicalGroup {
  /** Deterministic, stable group id (see `canonicalGroupId`). */
  id: string;
  /** Member locations, in catalog order. Never empty. */
  locations: GameLocation[];
  /** Why these members were merged — surfaced by the audit. */
  reason: 'explicit' | 'pano' | 'proximity' | 'single';
}

/** Deterministic id for a set of member ids: the lexicographically smallest. */
function derivedGroupId(memberIds: readonly string[]): string {
  return [...memberIds].sort()[0];
}

/**
 * Union–Find over catalog indices. Small and self-contained; the catalog is in
 * the hundreds of entries, so the O(n²) pair scan below is not worth
 * optimising into a spatial index yet (and a naive grid would be *wrong* near
 * the antimeridian and the poles).
 */
class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    // Path compression keeps repeated lookups cheap.
    let cur = x;
    while (this.parent[cur] !== cur) {
      const next = this.parent[cur];
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/**
 * Group locations that lie within `radiusKm` of each other, linked
 * transitively (A–B and B–C put A, B and C in one group even if A and C are
 * slightly further apart). Deterministic and order-independent.
 *
 * Exported because the audit reuses it at the coarser `clusterKm` radius to
 * report metro-area clusters.
 */
export function groupByProximity(
  locations: readonly GameLocation[],
  radiusKm: number,
): GameLocation[][] {
  const dsu = new DisjointSet(locations.length);
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      if (haversineDistanceKm(locations[i], locations[j]) <= radiusKm) {
        dsu.union(i, j);
      }
    }
  }

  const buckets = new Map<number, GameLocation[]>();
  for (let i = 0; i < locations.length; i++) {
    const root = dsu.find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(locations[i]);
    else buckets.set(root, [locations[i]]);
  }
  return [...buckets.values()];
}

/**
 * Build the canonical groups for a catalog, applying the precedence order
 * documented at the top of this file. Members are merged transitively across
 * all three rules — an explicit group and a proximity link that share a
 * location produce a single group, never two overlapping ones.
 */
export function buildCanonicalGroups(
  locations: readonly GameLocation[],
  thresholds: CanonicalThresholds = CANONICAL_THRESHOLDS,
): CanonicalGroup[] {
  const dsu = new DisjointSet(locations.length);

  // 1. Explicit groups.
  const byExplicit = new Map<string, number>();
  const explicitlyMerged = new Set<number>();
  locations.forEach((loc, i) => {
    if (!loc.locationGroupId) return;
    const first = byExplicit.get(loc.locationGroupId);
    if (first === undefined) {
      byExplicit.set(loc.locationGroupId, i);
    } else {
      dsu.union(first, i);
      explicitlyMerged.add(first).add(i);
    }
  });

  // 2. Same resolved panorama.
  const byPano = new Map<string, number>();
  const panoMerged = new Set<number>();
  locations.forEach((loc, i) => {
    if (!loc.panoId) return;
    const first = byPano.get(loc.panoId);
    if (first === undefined) {
      byPano.set(loc.panoId, i);
    } else {
      dsu.union(first, i);
      panoMerged.add(first).add(i);
    }
  });

  // 3. Geographic proximity.
  const proximityMerged = new Set<number>();
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      if (haversineDistanceKm(locations[i], locations[j]) <= thresholds.nearDuplicateKm) {
        dsu.union(i, j);
        proximityMerged.add(i).add(j);
      }
    }
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < locations.length; i++) {
    const root = dsu.find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(i);
    else buckets.set(root, [i]);
  }

  const groups: CanonicalGroup[] = [];
  for (const indices of buckets.values()) {
    const members = indices.map((i) => locations[i]);
    const explicitId = members.find((m) => m.locationGroupId)?.locationGroupId;
    let reason: CanonicalGroup['reason'] = 'single';
    if (members.length > 1) {
      if (indices.some((i) => explicitlyMerged.has(i))) reason = 'explicit';
      else if (indices.some((i) => panoMerged.has(i))) reason = 'pano';
      else if (indices.some((i) => proximityMerged.has(i))) reason = 'proximity';
    }
    groups.push({
      id: explicitId ?? derivedGroupId(members.map((m) => m.id)),
      locations: members,
      reason,
    });
  }

  // Stable output order: by group id, so audits and snapshots don't churn.
  groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return groups;
}

/**
 * Map every location id in the catalog to its canonical group id. This is the
 * lookup the selector and the history layer use — history stores *group* ids,
 * so recording one member marks the whole place as recently played.
 */
export function buildGroupIndex(
  locations: readonly GameLocation[],
  thresholds: CanonicalThresholds = CANONICAL_THRESHOLDS,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const group of buildCanonicalGroups(locations, thresholds)) {
    for (const member of group.locations) index.set(member.id, group.id);
  }
  return index;
}

/**
 * Memoised `buildGroupIndex`, keyed on the identity of the catalog array.
 *
 * Grouping is an O(n²) distance scan. That is trivial for one call, but Endless
 * mode selects a location every single round and multiplayer re-selects per
 * match — recomputing the whole catalog's grouping each time would be pure
 * waste. The catalog array is a module-level constant in practice, so identity
 * caching hits essentially always, and a `WeakMap` means a transient array
 * (tests, a future backend page) is collected normally.
 */
const groupIndexCache = new WeakMap<readonly GameLocation[], Map<string, string>>();

export function getGroupIndex(locations: readonly GameLocation[]): ReadonlyMap<string, string> {
  const cached = groupIndexCache.get(locations);
  if (cached) return cached;
  const index = buildGroupIndex(locations);
  groupIndexCache.set(locations, index);
  return index;
}

/**
 * Canonical group id for a single location, given a prebuilt index. Falls back
 * to the location's own id when it isn't in the index (e.g. a legacy stored
 * run whose location has since left the catalog) so callers never crash on
 * historical data.
 */
export function groupIdFor(index: ReadonlyMap<string, string>, locationId: string): string {
  return index.get(locationId) ?? locationId;
}

/** True when two locations sit in the same small geographic cluster. */
export function isSameCluster(
  a: GameLocation,
  b: GameLocation,
  thresholds: CanonicalThresholds = CANONICAL_THRESHOLDS,
): boolean {
  return haversineDistanceKm(a, b) <= thresholds.clusterKm;
}

/** True when two coordinates are identical within the audit's precision. */
export function hasIdenticalCoordinates(
  a: GameLocation,
  b: GameLocation,
  thresholds: CanonicalThresholds = CANONICAL_THRESHOLDS,
): boolean {
  return (
    Math.abs(a.lat - b.lat) < thresholds.identicalCoordinateDegrees &&
    Math.abs(a.lng - b.lng) < thresholds.identicalCoordinateDegrees
  );
}

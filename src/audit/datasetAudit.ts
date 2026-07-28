/**
 * Dataset audit — the diagnostic that has to come *before* replacing the
 * selector, because "players see the same places too often" has more than one
 * possible cause and guessing between them wastes a rewrite.
 *
 * This module answers, in machine-readable form:
 *   • how big the catalog actually is, per difficulty / country / continent /
 *     collection;
 *   • how many *distinct places* it contains once duplicates, same-panorama
 *     entries and near-identical coordinates are collapsed into canonical
 *     groups (this is the number that governs perceived variety, and it is
 *     always ≤ the raw row count);
 *   • which pools are too small to satisfy the product's own round counts.
 *
 * It is a pure function over a location array — no I/O, no network, no clock —
 * so it runs in unit tests and in the reporting CLI identically.
 */

import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, isDifficulty } from '../config/difficulty';
import type { Continent } from '../config/geography';
import { CONTINENTS, continentForCountry } from '../config/geography';
import type { CollectionId } from '../config/collections';
import { COLLECTION_IDS, locationsInCollection } from '../config/collections';
import {
  CANONICAL_THRESHOLDS,
  type CanonicalThresholds,
  buildCanonicalGroups,
  groupByProximity,
  hasIdenticalCoordinates,
} from '../utils/canonicalGroup';
import { haversineDistanceKm } from '../utils/distance';
import { buildDifficultyPool } from '../utils/difficultyPool';
import type { LocationSetting } from '../config/releaseGates';
import { LOCATION_SETTINGS, VERIFICATION_GATES, isLocationSetting } from '../config/releaseGates';
import {
  GAME_ROUND_COUNTS,
  STANDARD_ROUND_COUNT,
  TARGET_FRESH_GAMES,
  comfortablePoolSize,
  minimumPoolSize,
} from '../config/diversity';

export interface CountBucket {
  key: string;
  locations: number;
  /** Distinct canonical groups — the number that drives perceived variety. */
  groups: number;
}

export interface DuplicatePair {
  a: string;
  b: string;
  distanceKm: number;
}

export interface ClusterReport {
  /** Deterministic cluster id (smallest member location id). */
  id: string;
  members: string[];
  /** Widest great-circle distance between any two members, in km. */
  spanKm: number;
}

export interface PoolSufficiency {
  roundCount: number;
  /** Canonical groups available (after difficulty fallback, as in real play). */
  groups: number;
  /** Enough to run a game at all. */
  playable: boolean;
  /** Enough for `TARGET_FRESH_GAMES` repeat-free consecutive games. */
  comfortable: boolean;
  /** Groups still needed to reach `comfortable`. Zero when already there. */
  shortfall: number;
  /** True when adjacent-difficulty locations had to be mixed in. */
  usedFallback: boolean;
}

export interface DifficultyAudit {
  difficulty: Difficulty;
  locations: number;
  /** Groups from this tier alone, before any adjacent-tier fallback. */
  ownGroups: number;
  /** Canonical groups per physical setting within this tier. */
  settings: Record<LocationSetting, number>;
  sufficiency: PoolSufficiency[];
}

export interface VerificationAudit {
  /** Entries carrying a verified panorama id. */
  verified: number;
  /** Entries with no verified panorama id at all. */
  unverified: number;
  /** Verified, but checked longer ago than the staleness threshold. */
  stale: number;
  /** Entries whose `panoVerifiedAt` is missing or unparseable. */
  undatedVerification: number;
  verifiedPercent: number;
}

export interface CollectionAudit {
  collection: CollectionId;
  locations: number;
  groups: number;
  /** Per-difficulty group counts inside this collection. */
  groupsByDifficulty: Record<Difficulty, number>;
  sufficiency: PoolSufficiency[];
  /**
   * Whether this collection may be offered to players. A collection that
   * cannot fill a standard game twice over is reported unavailable rather
   * than shipped as a working option.
   */
  shippable: boolean;
}

export interface MetadataIssue {
  locationId: string;
  field:
    | 'id'
    | 'coordinates'
    | 'label'
    | 'country'
    | 'continent'
    | 'difficulty'
    | 'tags'
    | 'setting'
    | 'panoId'
    | 'panoVerifiedAt';
  message: string;
}

export interface DatasetAuditReport {
  thresholds: CanonicalThresholds;
  totals: {
    locations: number;
    canonicalGroups: number;
    /** Rows that collapse into a group with another row. */
    redundantLocations: number;
    countries: number;
    continents: number;
  };
  byDifficulty: DifficultyAudit[];
  byCountry: CountBucket[];
  byContinent: CountBucket[];
  byCollection: CollectionAudit[];
  duplicates: {
    duplicateLocationIds: string[];
    duplicatePanoIds: { panoId: string; locationIds: string[] }[];
    identicalCoordinates: DuplicatePair[];
    nearDuplicateCoordinates: DuplicatePair[];
    explicitGroups: { groupId: string; locationIds: string[] }[];
  };
  clusters: ClusterReport[];
  /** Street View verification state across the catalog. */
  verification: VerificationAudit;
  metadataIssues: MetadataIssue[];
  /**
   * Headline verdict for the configuration players actually get by default:
   * the standard round count at the default difficulty on the whole catalog.
   * Reported against the *default pool*, not the whole catalog — quoting the
   * catalog total would overstate variety, because a Normal game never draws
   * from the Easy and Hard tiers unless the fallback kicks in.
   */
  verdict: {
    standardRoundCount: number;
    targetFreshGames: number;
    defaultDifficulty: Difficulty;
    /** Groups in the whole catalog, all difficulties. */
    catalogGroups: number;
    /** Groups a default game can actually draw from. */
    defaultPoolGroups: number;
    groupsRequired: number;
    /** Consecutive standard games a player can play before a place repeats. */
    freshGamesSupported: number;
    sufficient: boolean;
  };
  ok: boolean;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function hasValidCoordinates(loc: GameLocation): boolean {
  return (
    isFiniteNumber(loc.lat) &&
    loc.lat >= -90 &&
    loc.lat <= 90 &&
    isFiniteNumber(loc.lng) &&
    loc.lng >= -180 &&
    loc.lng <= 180
  );
}

/** Count distinct canonical groups within an arbitrary subset of the catalog. */
function countGroups(
  subset: readonly GameLocation[],
  groupOf: ReadonlyMap<string, string>,
): number {
  const seen = new Set<string>();
  for (const loc of subset) seen.add(groupOf.get(loc.id) ?? loc.id);
  return seen.size;
}

function sufficiencyFor(
  groups: number,
  roundCount: number,
  usedFallback: boolean,
): PoolSufficiency {
  const comfortableTarget = comfortablePoolSize(roundCount);
  return {
    roundCount,
    groups,
    playable: groups >= minimumPoolSize(roundCount),
    comfortable: groups >= comfortableTarget,
    shortfall: Math.max(0, comfortableTarget - groups),
    usedFallback,
  };
}

/**
 * Audit `locations`. Values are read defensively (not trusting the compile-time
 * type) so the same function can validate data that arrives from a future
 * backend catalog, not just the bundled literal array.
 */
export function auditDataset(
  locations: readonly GameLocation[],
  thresholds: CanonicalThresholds = CANONICAL_THRESHOLDS,
): DatasetAuditReport {
  const metadataIssues: MetadataIssue[] = [];

  // ── Per-location metadata validation ────────────────────────────────────
  const seenIds = new Set<string>();
  for (const loc of locations) {
    const id = isNonEmptyString(loc.id) ? loc.id : '(missing id)';
    if (!isNonEmptyString(loc.id)) {
      metadataIssues.push({ locationId: id, field: 'id', message: 'Missing or empty location id.' });
    } else if (seenIds.has(loc.id)) {
      metadataIssues.push({
        locationId: id,
        field: 'id',
        message: `Duplicate location id "${loc.id}".`,
      });
    }
    seenIds.add(id);

    if (!hasValidCoordinates(loc)) {
      metadataIssues.push({
        locationId: id,
        field: 'coordinates',
        message: `Invalid coordinates (${String(loc.lat)}, ${String(loc.lng)}).`,
      });
    }
    if (!isNonEmptyString(loc.label)) {
      metadataIssues.push({ locationId: id, field: 'label', message: 'Missing label — a result screen cannot name this place.' });
    }
    if (!isNonEmptyString(loc.country)) {
      metadataIssues.push({ locationId: id, field: 'country', message: 'Missing country — breaks Country Streak and country diversity.' });
    } else if (continentForCountry(loc.country) === null) {
      metadataIssues.push({
        locationId: id,
        field: 'country',
        message: `Country "${loc.country}" is not in COUNTRY_CONTINENT (config/geography.ts) — continent cannot be derived.`,
      });
    }
    if (loc.continent === undefined) {
      metadataIssues.push({ locationId: id, field: 'continent', message: 'Missing continent metadata.' });
    } else if (isNonEmptyString(loc.country)) {
      const derived = continentForCountry(loc.country);
      if (derived !== null && derived !== loc.continent) {
        metadataIssues.push({
          locationId: id,
          field: 'continent',
          message: `Continent "${loc.continent}" disagrees with COUNTRY_CONTINENT ("${derived}") for ${loc.country}.`,
        });
      }
    }
    if (!isDifficulty(loc.difficulty)) {
      metadataIssues.push({
        locationId: id,
        field: 'difficulty',
        message: `Invalid difficulty "${String(loc.difficulty)}".`,
      });
    }
    if (loc.tags !== undefined && !Array.isArray(loc.tags)) {
      metadataIssues.push({ locationId: id, field: 'tags', message: 'Tags must be an array.' });
    }
    if (!isLocationSetting(loc.setting)) {
      metadataIssues.push({
        locationId: id,
        field: 'setting',
        message: `Missing or invalid setting ("${String(loc.setting)}") — required for the per-difficulty balance gates.`,
      });
    }
    if (!isNonEmptyString(loc.panoId)) {
      metadataIssues.push({
        locationId: id,
        field: 'panoId',
        message: 'No verified Street View panorama id — run the candidate verification workflow.',
      });
    } else if (!isNonEmptyString(loc.panoVerifiedAt) || !Number.isFinite(Date.parse(loc.panoVerifiedAt))) {
      metadataIssues.push({
        locationId: id,
        field: 'panoVerifiedAt',
        message: 'Panorama id has no valid verification date — its age cannot be judged.',
      });
    }
  }

  // ── Canonical grouping ──────────────────────────────────────────────────
  // Only locations with usable coordinates can be grouped geographically;
  // invalid ones are reported above and excluded here so one bad row cannot
  // poison every distance comparison.
  const groupable = locations.filter(hasValidCoordinates);
  const groups = buildCanonicalGroups(groupable, thresholds);
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.locations) groupOf.set(member.id, group.id);
  }

  // ── Duplicate detection ─────────────────────────────────────────────────
  const idCounts = new Map<string, number>();
  for (const loc of locations) {
    const id = isNonEmptyString(loc.id) ? loc.id : '(missing id)';
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const duplicateLocationIds = [...idCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();

  const panoBuckets = new Map<string, string[]>();
  for (const loc of locations) {
    if (!isNonEmptyString(loc.panoId)) continue;
    const bucket = panoBuckets.get(loc.panoId);
    if (bucket) bucket.push(loc.id);
    else panoBuckets.set(loc.panoId, [loc.id]);
  }
  const duplicatePanoIds = [...panoBuckets.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([panoId, locationIds]) => ({ panoId, locationIds: [...locationIds].sort() }))
    .sort((a, b) => (a.panoId < b.panoId ? -1 : 1));

  const identicalCoordinates: DuplicatePair[] = [];
  const nearDuplicateCoordinates: DuplicatePair[] = [];
  for (let i = 0; i < groupable.length; i++) {
    for (let j = i + 1; j < groupable.length; j++) {
      const a = groupable[i];
      const b = groupable[j];
      const distanceKm = haversineDistanceKm(a, b);
      if (hasIdenticalCoordinates(a, b, thresholds)) {
        identicalCoordinates.push({ a: a.id, b: b.id, distanceKm });
      } else if (distanceKm <= thresholds.nearDuplicateKm) {
        nearDuplicateCoordinates.push({ a: a.id, b: b.id, distanceKm });
      }
    }
  }

  const explicitBuckets = new Map<string, string[]>();
  for (const loc of locations) {
    if (!isNonEmptyString(loc.locationGroupId)) continue;
    const bucket = explicitBuckets.get(loc.locationGroupId);
    if (bucket) bucket.push(loc.id);
    else explicitBuckets.set(loc.locationGroupId, [loc.id]);
  }
  const explicitGroups = [...explicitBuckets.entries()]
    .map(([groupId, locationIds]) => ({ groupId, locationIds: [...locationIds].sort() }))
    .sort((a, b) => (a.groupId < b.groupId ? -1 : 1));

  // ── Metro-area clusters (soft-diversity input, never merges groups) ──────
  const clusters: ClusterReport[] = groupByProximity(groupable, thresholds.clusterKm)
    .filter((members) => members.length > 1)
    .map((members) => {
      let spanKm = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          spanKm = Math.max(spanKm, haversineDistanceKm(members[i], members[j]));
        }
      }
      const ids = members.map((m) => m.id).sort();
      return { id: ids[0], members: ids, spanKm };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  // ── Distribution buckets ────────────────────────────────────────────────
  const countryBuckets = new Map<string, GameLocation[]>();
  const continentBuckets = new Map<string, GameLocation[]>();
  const push = (map: Map<string, GameLocation[]>, key: string, loc: GameLocation): void => {
    const bucket = map.get(key);
    if (bucket) bucket.push(loc);
    else map.set(key, [loc]);
  };
  for (const loc of locations) {
    const country = isNonEmptyString(loc.country) ? loc.country : '(unknown)';
    const continent =
      loc.continent ??
      (isNonEmptyString(loc.country) ? continentForCountry(loc.country) : null) ??
      '(unknown)';
    push(countryBuckets, country, loc);
    push(continentBuckets, continent, loc);
  }

  const toBuckets = (map: Map<string, GameLocation[]>): CountBucket[] =>
    [...map.entries()]
      .map(([key, locs]) => ({ key, locations: locs.length, groups: countGroups(locs, groupOf) }))
      .sort((a, b) => b.locations - a.locations || (a.key < b.key ? -1 : 1));

  const byCountry = toBuckets(countryBuckets);
  const byContinent = toBuckets(continentBuckets);

  // ── Difficulty pools ────────────────────────────────────────────────────
  const byDifficulty: DifficultyAudit[] = DIFFICULTIES.map((difficulty) => {
    const own = groupable.filter((l) => l.difficulty === difficulty);
    const settings = LOCATION_SETTINGS.reduce(
      (acc, setting) => {
        acc[setting] = countGroups(
          own.filter((l) => l.setting === setting),
          groupOf,
        );
        return acc;
      },
      {} as Record<LocationSetting, number>,
    );
    return {
      difficulty,
      locations: own.length,
      ownGroups: countGroups(own, groupOf),
      settings,
      sufficiency: GAME_ROUND_COUNTS.map((roundCount) => {
        // Mirror real play: the pool widens to adjacent tiers only when the
        // tier's own pool cannot supply the round count.
        const pool = buildDifficultyPool(groupable, difficulty, roundCount);
        return sufficiencyFor(countGroups(pool.locations, groupOf), roundCount, pool.usedFallback);
      }),
    };
  });

  // ── Collections ─────────────────────────────────────────────────────────
  const byCollection: CollectionAudit[] = COLLECTION_IDS.map((collection) => {
    const members = locationsInCollection(groupable, collection);
    const groupsByDifficulty = DIFFICULTIES.reduce(
      (acc, d) => {
        acc[d] = countGroups(
          members.filter((l) => l.difficulty === d),
          groupOf,
        );
        return acc;
      },
      {} as Record<Difficulty, number>,
    );
    const totalGroups = countGroups(members, groupOf);
    const sufficiency = GAME_ROUND_COUNTS.map((roundCount) =>
      sufficiencyFor(totalGroups, roundCount, false),
    );
    return {
      collection,
      locations: members.length,
      groups: totalGroups,
      groupsByDifficulty,
      sufficiency,
      shippable: totalGroups >= minimumPoolSize(STANDARD_ROUND_COUNT),
    };
  });

  // ── Street View verification ────────────────────────────────────────────
  // A location is only "verified" when a real panorama id was resolved and
  // recorded. Coverage is withdrawn and re-shot over time, so verifications
  // also carry an age.
  const staleBefore = Date.now() - VERIFICATION_GATES.staleAfterDays * 86_400_000;
  let verified = 0;
  let stale = 0;
  let undatedVerification = 0;
  for (const loc of locations) {
    if (!isNonEmptyString(loc.panoId)) continue;
    verified += 1;
    const checkedAt = isNonEmptyString(loc.panoVerifiedAt) ? Date.parse(loc.panoVerifiedAt) : NaN;
    if (!Number.isFinite(checkedAt)) undatedVerification += 1;
    else if (checkedAt < staleBefore) stale += 1;
  }
  const verification: VerificationAudit = {
    verified,
    unverified: locations.length - verified,
    stale,
    undatedVerification,
    verifiedPercent: locations.length > 0 ? (verified / locations.length) * 100 : 0,
  };

  const totalGroups = groups.length;
  const groupsRequired = comfortablePoolSize(STANDARD_ROUND_COUNT);
  const defaultPool = buildDifficultyPool(groupable, DEFAULT_DIFFICULTY, STANDARD_ROUND_COUNT);
  const defaultPoolGroups = countGroups(defaultPool.locations, groupOf);

  const report: DatasetAuditReport = {
    thresholds,
    totals: {
      locations: locations.length,
      canonicalGroups: totalGroups,
      redundantLocations: groupable.length - totalGroups,
      countries: byCountry.length,
      continents: byContinent.length,
    },
    byDifficulty,
    byCountry,
    byContinent,
    byCollection,
    duplicates: {
      duplicateLocationIds,
      duplicatePanoIds,
      identicalCoordinates,
      nearDuplicateCoordinates,
      explicitGroups,
    },
    clusters,
    verification,
    metadataIssues,
    verdict: {
      standardRoundCount: STANDARD_ROUND_COUNT,
      targetFreshGames: TARGET_FRESH_GAMES,
      defaultDifficulty: DEFAULT_DIFFICULTY,
      catalogGroups: totalGroups,
      defaultPoolGroups,
      groupsRequired,
      freshGamesSupported: Math.floor(defaultPoolGroups / STANDARD_ROUND_COUNT),
      sufficient: defaultPoolGroups >= groupsRequired,
    },
    ok: metadataIssues.length === 0 && duplicateLocationIds.length === 0,
  };

  return report;
}

/** All continents that currently have at least one location. */
export function representedContinents(locations: readonly GameLocation[]): Continent[] {
  const seen = new Set<Continent>();
  for (const loc of locations) {
    const c = loc.continent ?? continentForCountry(loc.country);
    if (c) seen.add(c);
  }
  return CONTINENTS.filter((c) => seen.has(c));
}

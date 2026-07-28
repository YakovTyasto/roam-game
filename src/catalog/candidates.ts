/**
 * Candidate validation for catalog expansion.
 *
 * Everything in this module is **pure and offline**. It decides whether a
 * proposed location is structurally sound, correctly described, and genuinely
 * new relative to the existing catalog and to the rest of its own batch.
 *
 * What it deliberately does NOT do is decide whether a panorama exists. That
 * requires a network call to Google, so it lives in the opt-in CLI step
 * (`scripts/verify-candidates.ts`) and never runs during a build or a test.
 *
 * The rule the whole workflow is built around:
 *
 *   > A candidate is never promoted to a catalog entry on the strength of
 *   > plausibility. It must survive offline validation AND have a real
 *   > panorama id resolved and recorded. Nothing is guessed, and no
 *   > unverified location is ever written to `src/data/locations.ts`.
 */

import type { CatalogLocation, GameLocation } from '../types';
import { isDifficulty } from '../config/difficulty';
import { continentForCountry, isContinent } from '../config/geography';
import { isCuratedTag } from '../config/collections';
import { isLocationSetting } from '../config/releaseGates';
import { CONCENTRATION_GATES } from '../config/releaseGates';
import { CANONICAL_THRESHOLDS } from '../utils/canonicalGroup';
import { haversineDistanceKm } from '../utils/distance';

/** A proposed location, as authored in a batch file. */
export interface Candidate {
  id: string;
  lat: number;
  lng: number;
  label: string;
  country: string;
  difficulty: string;
  setting: string;
  tags?: readonly string[];
  /** Optional explicit continent; derived from country when omitted. */
  continent?: string;
  /** Free-text note on where the coordinate came from. Required for review. */
  source?: string;
  /**
   * Why this location earns a place in the catalog — which gate it moves, what
   * it adds that the catalog lacks. Distinct from `source`, which says where
   * the *coordinate* came from. Not machine-checked: a reviewer reads it to
   * decide whether the batch is well-composed or just longer.
   */
  rationale?: string;
  /** Optional explicit canonical group, for deliberate same-place entries. */
  locationGroupId?: string;
}

export interface CandidateIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface CandidateResult {
  candidate: Candidate;
  /** Errors block promotion; warnings are for the reviewer's judgement. */
  issues: CandidateIssue[];
  /** True when nothing blocks it from proceeding to panorama verification. */
  accepted: boolean;
}

export interface BatchValidationReport {
  batchSize: number;
  results: CandidateResult[];
  accepted: CandidateResult[];
  rejected: CandidateResult[];
  /** Counts by issue code, for a quick read of what went wrong. */
  issueCounts: Record<string, number>;
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate one batch of candidates against the existing catalog and against
 * each other.
 *
 * Batch size is a review constraint, not a technical one: 25–50 candidates is
 * what a human can actually check. The CLI enforces it; this function does not,
 * so tests can use whatever size they need.
 */
export function validateCandidateBatch(
  candidates: readonly Candidate[],
  catalog: readonly GameLocation[],
): BatchValidationReport {
  const results: CandidateResult[] = [];

  const catalogIds = new Set(catalog.map((l) => l.id));
  const seenIds = new Set<string>();

  for (const candidate of candidates) {
    const issues: CandidateIssue[] = [];
    const add = (severity: CandidateIssue['severity'], code: string, message: string): void => {
      issues.push({ severity, code, message });
    };

    // ── Shape and types ───────────────────────────────────────────────────
    if (!isNonEmptyString(candidate.id)) {
      add('error', 'id.missing', 'Missing id.');
    } else if (!ID_PATTERN.test(candidate.id)) {
      add('error', 'id.format', `Id "${candidate.id}" must be lowercase kebab-case.`);
    } else if (catalogIds.has(candidate.id)) {
      add('error', 'id.duplicateCatalog', `Id "${candidate.id}" already exists in the catalog.`);
    } else if (seenIds.has(candidate.id)) {
      add('error', 'id.duplicateBatch', `Id "${candidate.id}" appears twice in this batch.`);
    }
    if (isNonEmptyString(candidate.id)) seenIds.add(candidate.id);

    const hasCoords =
      isFiniteNumber(candidate.lat) &&
      candidate.lat >= -90 &&
      candidate.lat <= 90 &&
      isFiniteNumber(candidate.lng) &&
      candidate.lng >= -180 &&
      candidate.lng <= 180;
    if (!hasCoords) {
      add(
        'error',
        'coordinates.invalid',
        `Invalid coordinates (${String(candidate.lat)}, ${String(candidate.lng)}).`,
      );
    } else if (candidate.lat === 0 && candidate.lng === 0) {
      // Null Island is almost always a data-entry mistake, not a location.
      add('error', 'coordinates.nullIsland', 'Coordinates are (0, 0) — almost certainly a mistake.');
    }

    if (!isNonEmptyString(candidate.label)) {
      add('error', 'label.missing', 'Missing label — the result screen needs a name.');
    }
    if (!isNonEmptyString(candidate.source)) {
      add(
        'warning',
        'source.missing',
        'No source note. Reviewers cannot tell where this coordinate came from.',
      );
    }

    // ── Metadata ──────────────────────────────────────────────────────────
    if (!isDifficulty(candidate.difficulty)) {
      add('error', 'difficulty.invalid', `Invalid difficulty "${String(candidate.difficulty)}".`);
    }
    if (!isLocationSetting(candidate.setting)) {
      add('error', 'setting.invalid', `Invalid setting "${String(candidate.setting)}".`);
    }
    for (const tag of candidate.tags ?? []) {
      if (!isCuratedTag(tag)) {
        add(
          'error',
          'tags.invalid',
          `Tag "${String(tag)}" is not a curated tag. Continent, island and ` +
            'left-driving collections are derived and must not be hand-tagged.',
        );
      }
    }

    if (!isNonEmptyString(candidate.country)) {
      add('error', 'country.missing', 'Missing country.');
    } else {
      const derived = continentForCountry(candidate.country);
      if (derived === null) {
        add(
          'error',
          'country.unknown',
          `Country "${candidate.country}" is not in COUNTRY_CONTINENT ` +
            '(src/config/geography.ts). Add it there first, deliberately — the ' +
            'continent must not be guessed here.',
        );
      } else if (candidate.continent !== undefined) {
        if (!isContinent(candidate.continent)) {
          add('error', 'continent.invalid', `Invalid continent "${String(candidate.continent)}".`);
        } else if (candidate.continent !== derived) {
          add(
            'error',
            'continent.mismatch',
            `Continent "${candidate.continent}" disagrees with COUNTRY_CONTINENT ("${derived}").`,
          );
        }
      }
    }

    // ── Novelty against the catalog and the rest of the batch ─────────────
    if (hasCoords) {
      const point = { lat: candidate.lat, lng: candidate.lng };

      for (const existing of catalog) {
        const distanceKm = haversineDistanceKm(point, existing);
        if (distanceKm <= CANONICAL_THRESHOLDS.nearDuplicateKm) {
          add(
            'error',
            'novelty.catalogDuplicate',
            `Within ${distanceKm.toFixed(2)} km of catalog location "${existing.id}" — ` +
              'the same canonical place, not a new one.',
          );
          break;
        }
      }

      for (const other of results) {
        if (!isFiniteNumber(other.candidate.lat)) continue;
        const distanceKm = haversineDistanceKm(point, {
          lat: other.candidate.lat,
          lng: other.candidate.lng,
        });
        if (distanceKm <= CANONICAL_THRESHOLDS.nearDuplicateKm) {
          add(
            'error',
            'novelty.batchDuplicate',
            `Within ${distanceKm.toFixed(2)} km of batch candidate "${other.candidate.id}".`,
          );
          break;
        }
      }

      // Concentration: count everything already inside this candidate's cluster,
      // from the catalog and from earlier accepted candidates in the batch.
      let clusterSize = catalog.filter(
        (l) => haversineDistanceKm(point, l) <= CANONICAL_THRESHOLDS.clusterKm,
      ).length;
      clusterSize += results.filter(
        (r) =>
          r.accepted &&
          isFiniteNumber(r.candidate.lat) &&
          haversineDistanceKm(point, { lat: r.candidate.lat, lng: r.candidate.lng }) <=
            CANONICAL_THRESHOLDS.clusterKm,
      ).length;
      if (clusterSize >= CONCENTRATION_GATES.maxGroupsPerCluster) {
        add(
          'error',
          'concentration.cluster',
          `Would make ${clusterSize + 1} locations within ${CANONICAL_THRESHOLDS.clusterKm} km — ` +
            `the limit is ${CONCENTRATION_GATES.maxGroupsPerCluster}. Pick a different city.`,
        );
      }
    }

    if (isNonEmptyString(candidate.locationGroupId)) {
      add(
        'warning',
        'group.explicit',
        `Declares explicit group "${candidate.locationGroupId}" — confirm this really is ` +
          'the same place as its group-mates.',
      );
    }

    const accepted = !issues.some((i) => i.severity === 'error');
    results.push({ candidate, issues, accepted });
  }

  const issueCounts: Record<string, number> = {};
  for (const result of results) {
    for (const issue of result.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
  }

  return {
    batchSize: candidates.length,
    results,
    accepted: results.filter((r) => r.accepted),
    rejected: results.filter((r) => !r.accepted),
    issueCounts,
  };
}

/** A candidate that has survived validation AND panorama verification. */
export interface VerifiedCandidate {
  candidate: Candidate;
  /** Real panorama id returned by the Street View metadata endpoint. */
  panoId: string;
  /** ISO date (YYYY-MM-DD) the check was made. */
  verifiedAt: string;
  /** Distance from the requested coordinate to the resolved panorama, in km. */
  offsetKm: number;
}

/**
 * Convert a verified candidate into a catalog entry.
 *
 * Requires a `panoId`, by type — it is impossible to call this with an
 * unverified candidate, which is the point.
 */
export function toCatalogLocation(verified: VerifiedCandidate): CatalogLocation {
  const { candidate } = verified;
  const continent = continentForCountry(candidate.country);
  if (continent === null) {
    throw new Error(
      `Cannot build a catalog entry for "${candidate.id}": country "${candidate.country}" ` +
        'has no continent mapping.',
    );
  }
  if (!isDifficulty(candidate.difficulty) || !isLocationSetting(candidate.setting)) {
    throw new Error(`Cannot build a catalog entry for "${candidate.id}": invalid metadata.`);
  }

  return {
    id: candidate.id,
    lat: candidate.lat,
    lng: candidate.lng,
    label: candidate.label,
    country: candidate.country,
    continent,
    difficulty: candidate.difficulty,
    tags: (candidate.tags ?? []).filter(isCuratedTag),
    setting: candidate.setting,
    panoId: verified.panoId,
    panoVerifiedAt: verified.verifiedAt,
    ...(candidate.locationGroupId ? { locationGroupId: candidate.locationGroupId } : {}),
  };
}

/** Render catalog entries as source lines, matching the existing file style. */
export function renderCatalogEntries(locations: readonly CatalogLocation[]): string {
  return locations
    .map((l) => {
      const parts = [
        `id: '${l.id}'`,
        `lat: ${l.lat}`,
        `lng: ${l.lng}`,
        `label: '${l.label.replace(/'/g, "\\'")}'`,
        `country: '${l.country}'`,
        `continent: '${l.continent}'`,
        `difficulty: '${l.difficulty}'`,
        `tags: [${l.tags.map((t) => `'${t}'`).join(', ')}]`,
        `setting: '${l.setting}'`,
        `panoId: '${l.panoId}'`,
        `panoVerifiedAt: '${l.panoVerifiedAt}'`,
      ];
      if (l.locationGroupId) parts.push(`locationGroupId: '${l.locationGroupId}'`);
      return `  { ${parts.join(', ')} },`;
    })
    .join('\n');
}

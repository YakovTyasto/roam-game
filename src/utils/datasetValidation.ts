import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { DIFFICULTIES, isDifficulty } from '../config/difficulty';
import { buildDifficultyPool } from './difficultyPool';

/**
 * Static audit of the location dataset (`src/data/locations.ts`) — catches
 * regressions before they reach players, and doubles as the contract a future
 * backend-backed `LocationProvider` implementation must satisfy (see
 * providers/LocationProvider.ts). Values here are read loosely (not solely
 * relying on the compile-time `GameLocation` type) so it stays useful against
 * runtime/network data, not just the bundled literal array.
 */
export type DatasetIssueType =
  | 'duplicate-id'
  | 'invalid-coordinates'
  | 'missing-panorama-data'
  | 'invalid-difficulty'
  | 'insufficient-pool';

export interface DatasetIssue {
  type: DatasetIssueType;
  message: string;
  locationId?: string;
  difficulty?: Difficulty;
}

export interface DatasetValidationReport {
  ok: boolean;
  issues: DatasetIssue[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate the dataset itself: unique ids, valid coordinates, non-empty
 * label/country (the minimum needed to resolve a panorama and render a
 * result — see the identical "missing panorama data" check applied to
 * resolved round manifests in multiplayer/manifest.ts#validateManifest),
 * and a valid difficulty tag on every location. Also checks that every
 * difficulty preset can supply `minPoolPerDifficulty` unique locations —
 * with the adjacent-tier fallback allowed, exactly like real gameplay.
 */
export function validateLocationDataset(
  locations: readonly GameLocation[],
  minPoolPerDifficulty: number,
): DatasetValidationReport {
  const issues: DatasetIssue[] = [];
  const seenIds = new Set<string>();

  for (const loc of locations) {
    const id = typeof loc.id === 'string' ? loc.id : '(missing id)';

    if (seenIds.has(id)) {
      issues.push({
        type: 'duplicate-id',
        message: `Duplicate location id "${id}".`,
        locationId: id,
      });
    }
    seenIds.add(id);

    if (!isFiniteNumber(loc.lat) || loc.lat < -90 || loc.lat > 90 ||
        !isFiniteNumber(loc.lng) || loc.lng < -180 || loc.lng > 180) {
      issues.push({
        type: 'invalid-coordinates',
        message: `Location "${id}" has invalid coordinates (${String(loc.lat)}, ${String(loc.lng)}).`,
        locationId: id,
      });
    }

    if (!isNonEmptyString(loc.label) || !isNonEmptyString(loc.country)) {
      issues.push({
        type: 'missing-panorama-data',
        message: `Location "${id}" is missing a label or country — cannot resolve/render a panorama result.`,
        locationId: id,
      });
    }

    if (!isDifficulty(loc.difficulty)) {
      issues.push({
        type: 'invalid-difficulty',
        message: `Location "${id}" has an invalid/unknown difficulty ("${String(loc.difficulty)}") — defaults to Normal at selection time.`,
        locationId: id,
      });
    }
  }

  for (const d of DIFFICULTIES) {
    const pool = buildDifficultyPool(locations, d, minPoolPerDifficulty);
    if (!pool.sufficient) {
      issues.push({
        type: 'insufficient-pool',
        message: `Difficulty "${d}" cannot supply ${minPoolPerDifficulty} unique locations even with adjacent-tier fallback (found ${pool.locations.length}).`,
        difficulty: d,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Release-gate evaluation.
 *
 * Turns the catalog audit into a pass/fail verdict against
 * `config/releaseGates.ts`. `npm run audit:gates` exits non-zero while any gate
 * fails, so "the catalog is ready" is a machine-checked claim.
 *
 * The distinction this module enforces matters: `config/diversity.ts` computes
 * the *mathematical* floor below which the selector provably cannot deliver
 * repeat-free games. Clearing that floor does not make a catalog good — a
 * 50-place catalog clears it and still shows every player the same fifty places
 * forever. The gates here are the production quality bar, and they are several
 * times the floor.
 *
 * Pure: no I/O, no clock beyond what the audit already resolved.
 */

import type { Difficulty } from '../config/difficulty';
import { DIFFICULTIES } from '../config/difficulty';
import type { LocationSetting, SettingRule } from '../config/releaseGates';
import {
  BREADTH_GATES,
  CONCENTRATION_GATES,
  MIN_GROUPS_BY_DIFFICULTY,
  MIN_TOTAL_GROUPS,
  SETTING_RULES,
  VERIFICATION_GATES,
} from '../config/releaseGates';
import type { DatasetAuditReport } from './datasetAudit';

export type GateCategory =
  | 'size'
  | 'breadth'
  | 'concentration'
  | 'balance'
  | 'verification'
  | 'integrity';

export interface GateResult {
  id: string;
  category: GateCategory;
  /** What the gate requires, in plain language. */
  requirement: string;
  /** What the catalog currently provides. */
  actual: string;
  passed: boolean;
  /** How far short, when the gate is a simple count. */
  shortfall?: number;
  /** Why the gate exists — carried through from the config. */
  rationale?: string;
}

export interface ReleaseGateReport {
  passed: boolean;
  gates: GateResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    byCategory: Record<GateCategory, { passed: number; failed: number }>;
  };
  /**
   * Groups still required per difficulty to clear the size gates. The single
   * most actionable number in the whole report.
   */
  groupsStillNeeded: Record<Difficulty, number> & { total: number };
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function describeSettings(settings: readonly LocationSetting[]): string {
  return settings.join(' + ');
}

function evaluateSettingRule(
  difficulty: Difficulty,
  rule: SettingRule,
  counts: Record<LocationSetting, number>,
  tierGroups: number,
): GateResult[] {
  const matched = rule.settings.reduce((sum, setting) => sum + (counts[setting] ?? 0), 0);
  const share = pct(matched, tierGroups);
  const label = describeSettings(rule.settings);
  const results: GateResult[] = [];

  if (rule.minSharePercent !== undefined) {
    results.push({
      id: `balance.${difficulty}.${rule.settings.join('-')}.min`,
      category: 'balance',
      requirement: `${difficulty}: at least ${rule.minSharePercent}% ${label}`,
      actual: `${share.toFixed(1)}% (${matched}/${tierGroups})`,
      // An empty tier cannot satisfy a share rule; the size gate already
      // reports that, so this is not double-counted as a balance failure.
      passed: tierGroups === 0 ? false : share >= rule.minSharePercent,
      rationale: rule.rationale,
    });
  }
  if (rule.maxSharePercent !== undefined) {
    results.push({
      id: `balance.${difficulty}.${rule.settings.join('-')}.max`,
      category: 'balance',
      requirement: `${difficulty}: at most ${rule.maxSharePercent}% ${label}`,
      actual: `${share.toFixed(1)}% (${matched}/${tierGroups})`,
      passed: tierGroups === 0 ? false : share <= rule.maxSharePercent,
      rationale: rule.rationale,
    });
  }
  return results;
}

/** Evaluate every release gate against an audit report. */
export function evaluateReleaseGates(report: DatasetAuditReport): ReleaseGateReport {
  const gates: GateResult[] = [];
  const groupsStillNeeded = { easy: 0, normal: 0, hard: 0, total: 0 } as Record<Difficulty, number> & {
    total: number;
  };

  // ── Size ────────────────────────────────────────────────────────────────
  for (const difficulty of DIFFICULTIES) {
    const tier = report.byDifficulty.find((d) => d.difficulty === difficulty);
    // Own groups, NOT the fallback-widened pool: a tier padded by borrowing
    // from its neighbours has not actually grown.
    const actual = tier?.ownGroups ?? 0;
    const required = MIN_GROUPS_BY_DIFFICULTY[difficulty];
    const shortfall = Math.max(0, required - actual);
    groupsStillNeeded[difficulty] = shortfall;
    gates.push({
      id: `size.${difficulty}`,
      category: 'size',
      requirement: `${required} validated ${difficulty} canonical groups`,
      actual: `${actual}`,
      passed: actual >= required,
      shortfall,
      rationale: 'Tier counts are measured on the tier itself; adjacent-difficulty fallback does not count.',
    });
  }

  const totalShortfall = Math.max(0, MIN_TOTAL_GROUPS - report.totals.canonicalGroups);
  groupsStillNeeded.total = totalShortfall;
  gates.push({
    id: 'size.total',
    category: 'size',
    requirement: `${MIN_TOTAL_GROUPS} total unique canonical groups`,
    actual: `${report.totals.canonicalGroups}`,
    passed: report.totals.canonicalGroups >= MIN_TOTAL_GROUPS,
    shortfall: totalShortfall,
    rationale: 'Checked independently of the tiers so entries that collapse into shared groups cannot pad a count.',
  });

  // ── Breadth ─────────────────────────────────────────────────────────────
  gates.push({
    id: 'breadth.countries',
    category: 'breadth',
    requirement: `at least ${BREADTH_GATES.minCountries} countries`,
    actual: `${report.totals.countries}`,
    passed: report.totals.countries >= BREADTH_GATES.minCountries,
    shortfall: Math.max(0, BREADTH_GATES.minCountries - report.totals.countries),
  });

  const populatedContinents = report.byContinent.filter((c) => c.key !== '(unknown)');
  gates.push({
    id: 'breadth.continents',
    category: 'breadth',
    requirement: `at least ${BREADTH_GATES.minContinentsRepresented} continents represented`,
    actual: `${populatedContinents.length}`,
    passed: populatedContinents.length >= BREADTH_GATES.minContinentsRepresented,
  });

  const thinContinents = populatedContinents.filter(
    (c) => c.groups < BREADTH_GATES.minGroupsPerContinent,
  );
  gates.push({
    id: 'breadth.continentDepth',
    category: 'breadth',
    requirement: `every represented continent holds at least ${BREADTH_GATES.minGroupsPerContinent} groups`,
    actual:
      thinContinents.length === 0
        ? 'all continents meet the floor'
        : thinContinents.map((c) => `${c.key} ${c.groups}`).join(', '),
    passed: thinContinents.length === 0,
    rationale: 'Prevents "six continents represented" being satisfied by one location each.',
  });

  // ── Concentration ───────────────────────────────────────────────────────
  const total = report.totals.canonicalGroups;
  const topCountry = report.byCountry[0];
  const topCountryShare = topCountry ? pct(topCountry.groups, total) : 0;
  gates.push({
    id: 'concentration.country',
    category: 'concentration',
    requirement: `no country above ${CONCENTRATION_GATES.maxCountrySharePercent}% of the catalog`,
    actual: topCountry
      ? `${topCountry.key} ${topCountryShare.toFixed(1)}% (${topCountry.groups}/${total})`
      : 'no countries',
    passed: topCountryShare <= CONCENTRATION_GATES.maxCountrySharePercent,
  });

  const overloadedClusters = report.clusters.filter(
    (c) => c.members.length > CONCENTRATION_GATES.maxGroupsPerCluster,
  );
  gates.push({
    id: 'concentration.cluster',
    category: 'concentration',
    requirement: `no more than ${CONCENTRATION_GATES.maxGroupsPerCluster} groups within one 25 km cluster`,
    actual:
      overloadedClusters.length === 0
        ? 'no cluster is overloaded'
        : overloadedClusters.map((c) => `${c.id} (${c.members.length})`).join(', '),
    passed: overloadedClusters.length === 0,
    rationale: 'The audit\'s proxy for "one city". Same-road duplication is handled structurally by canonical grouping.',
  });

  // ── Integrity ───────────────────────────────────────────────────────────
  const d = report.duplicates;
  gates.push({
    id: 'integrity.duplicatePanoIds',
    category: 'integrity',
    requirement: 'no duplicate panorama ids',
    actual: `${d.duplicatePanoIds.length} duplicate pano id(s)`,
    passed: d.duplicatePanoIds.length === 0,
  });
  gates.push({
    id: 'integrity.nearDuplicates',
    category: 'integrity',
    requirement: 'no identical or near-duplicate coordinates',
    actual: `${d.identicalCoordinates.length} identical, ${d.nearDuplicateCoordinates.length} near-duplicate pair(s)`,
    passed: d.identicalCoordinates.length === 0 && d.nearDuplicateCoordinates.length === 0,
  });
  gates.push({
    id: 'integrity.redundantGroups',
    category: 'integrity',
    requirement: 'no catalog row collapses into another row\'s canonical group',
    actual: `${report.totals.redundantLocations} redundant row(s)`,
    passed: report.totals.redundantLocations === 0,
  });
  gates.push({
    id: 'integrity.metadata',
    category: 'integrity',
    requirement: 'every location has reviewed difficulty, country, continent, setting and collection metadata',
    actual: `${report.metadataIssues.length} metadata issue(s)`,
    passed: report.metadataIssues.length === 0,
  });

  // ── Verification ────────────────────────────────────────────────────────
  gates.push({
    id: 'verification.streetView',
    category: 'verification',
    requirement: `${VERIFICATION_GATES.minVerifiedPercent}% of locations have a verified Street View panorama`,
    actual: `${report.verification.verifiedPercent.toFixed(1)}% (${report.verification.verified}/${
      report.verification.verified + report.verification.unverified
    })`,
    passed: report.verification.verifiedPercent >= VERIFICATION_GATES.minVerifiedPercent,
    shortfall: report.verification.unverified,
    rationale: 'A location nobody confirmed can strand a player on a blank panorama.',
  });
  gates.push({
    id: 'verification.dated',
    category: 'verification',
    requirement: 'every verified panorama records when it was checked',
    actual: `${report.verification.undatedVerification} undated verification(s)`,
    passed: report.verification.undatedVerification === 0,
    rationale: 'Street View coverage is withdrawn and re-shot; an undated check cannot be aged.',
  });

  // ── Balance ─────────────────────────────────────────────────────────────
  for (const difficulty of DIFFICULTIES) {
    const tier = report.byDifficulty.find((t) => t.difficulty === difficulty);
    const counts =
      tier?.settings ??
      ({ urban: 0, suburban: 0, rural: 0, landmark: 0, remote: 0 } as Record<LocationSetting, number>);
    for (const rule of SETTING_RULES[difficulty]) {
      gates.push(...evaluateSettingRule(difficulty, rule, counts, tier?.ownGroups ?? 0));
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const byCategory = {
    size: { passed: 0, failed: 0 },
    breadth: { passed: 0, failed: 0 },
    concentration: { passed: 0, failed: 0 },
    balance: { passed: 0, failed: 0 },
    verification: { passed: 0, failed: 0 },
    integrity: { passed: 0, failed: 0 },
  } satisfies Record<GateCategory, { passed: number; failed: number }>;

  for (const gate of gates) {
    if (gate.passed) byCategory[gate.category].passed += 1;
    else byCategory[gate.category].failed += 1;
  }

  const failed = gates.filter((g) => !g.passed).length;

  return {
    passed: failed === 0,
    gates,
    summary: {
      total: gates.length,
      passed: gates.length - failed,
      failed,
      byCategory,
    },
    groupsStillNeeded,
  };
}

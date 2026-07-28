/**
 * V4 catalog release gates.
 *
 * These are **blocking minimums, not aspirations.** The audit evaluates every
 * gate below and `npm run audit:gates` exits non-zero while any of them fails,
 * so "the catalog is big enough" is a machine-checked claim rather than a
 * judgement call.
 *
 * Why they exist: `config/diversity.ts` derives the *mathematical* minimum pool
 * for N repeat-free games (50 groups for ten five-round games). That number is
 * a floor below which the selector provably cannot deliver variety — it is not
 * a production quality target. A 50-place catalog that clears it still shows
 * every player the same fifty places forever. The gates here are the quality
 * target, and they are deliberately several times the mathematical floor.
 *
 * A shuffle bag guarantees coverage of whatever exists. It cannot manufacture
 * places, and nothing in this codebase should imply that it can.
 *
 * Every threshold is tunable in this one file, and every one is justified in a
 * comment. Changing a gate is a reviewable decision, not an accident.
 */

import type { Difficulty } from './difficulty';

/**
 * Physical character of a location. Drives the balance requirements below:
 * a "Hard" tier made entirely of famous city centres is not actually hard, and
 * that is precisely the shape the pre-V4 catalog had.
 */
export type LocationSetting = 'urban' | 'suburban' | 'rural' | 'landmark' | 'remote';

export const LOCATION_SETTINGS: readonly LocationSetting[] = [
  'urban',
  'suburban',
  'rural',
  'landmark',
  'remote',
] as const;

export function isLocationSetting(value: unknown): value is LocationSetting {
  return typeof value === 'string' && (LOCATION_SETTINGS as readonly string[]).includes(value);
}

/** Minimum validated canonical groups required per difficulty tier. */
export const MIN_GROUPS_BY_DIFFICULTY: Readonly<Record<Difficulty, number>> = {
  easy: 80,
  normal: 140,
  hard: 80,
};

/**
 * Minimum total distinct canonical groups. Deliberately larger than the sum of
 * the tiers is not required — the sum is 300 exactly — but the total is checked
 * independently so a tier cannot be padded by locations that collapse into
 * shared canonical groups.
 */
export const MIN_TOTAL_GROUPS = 300;

/**
 * Breadth requirements.
 *
 * `minCountries` is set so the catalog cannot satisfy the tier counts by
 * stacking a handful of well-covered countries: 60 countries across 300 groups
 * means five per country on average.
 *
 * `minGroupsPerContinent` excludes Antarctica, which has no meaningful Street
 * View street coverage.
 */
export const BREADTH_GATES = {
  minCountries: 60,
  minContinentsRepresented: 6,
  minGroupsPerContinent: 15,
} as const;

/**
 * Concentration limits — "no excessive concentration in one city, country, or
 * road".
 *
 * • `maxCountrySharePercent` caps any single country's share of the catalog.
 *   10% of 300 is 30 groups, generous for a large country like the US or
 *   Brazil while preventing a catalog that is one-third American.
 * • `maxGroupsPerCluster` limits how many groups may sit inside one 25 km
 *   cluster — the audit's proxy for "one city". Three lets a big city carry a
 *   few genuinely different districts without becoming a tour of one place.
 * • Same-road and near-duplicate concentration is handled structurally rather
 *   than by a threshold: anything within `nearDuplicateKm` (1 km) is already
 *   merged into a single canonical group, so it cannot inflate any count.
 */
export const CONCENTRATION_GATES = {
  maxCountrySharePercent: 10,
  maxGroupsPerCluster: 3,
} as const;

export interface SettingRule {
  /** Settings this rule covers. Shares are summed across them. */
  settings: readonly LocationSetting[];
  /** Minimum share of the tier, as a percentage. */
  minSharePercent?: number;
  /** Maximum share of the tier, as a percentage. */
  maxSharePercent?: number;
  /** Why this rule exists, surfaced in the audit output. */
  rationale: string;
}

/**
 * Setting balance per difficulty. These encode what each tier is *supposed to
 * feel like*, which the pre-V4 catalog did not enforce at all — its "Hard" tier
 * was 100% urban and landmark, which is why Hard was not meaningfully harder
 * than Normal.
 */
export const SETTING_RULES: Readonly<Record<Difficulty, readonly SettingRule[]>> = {
  easy: [
    {
      settings: ['landmark'],
      minSharePercent: 35,
      rationale: 'Easy should lead with recognisable landmarks.',
    },
    {
      settings: ['landmark', 'urban'],
      minSharePercent: 80,
      rationale: 'Easy should stay in places with strong, legible clues.',
    },
    {
      settings: ['remote'],
      maxSharePercent: 5,
      rationale: 'A remote spot is not an easy guess.',
    },
  ],
  normal: [
    {
      settings: ['urban'],
      minSharePercent: 25,
      rationale: 'Normal keeps a solid urban core.',
    },
    {
      settings: ['suburban'],
      minSharePercent: 20,
      rationale: 'Suburbia is the classic mid-difficulty guess.',
    },
    {
      settings: ['rural', 'remote'],
      minSharePercent: 15,
      rationale: 'Normal needs countryside to not feel like a city tour.',
    },
    {
      settings: ['landmark'],
      maxSharePercent: 20,
      rationale: 'Too many landmarks make Normal play like Easy.',
    },
  ],
  hard: [
    {
      settings: ['rural', 'remote'],
      minSharePercent: 45,
      rationale: 'Hard must be mostly countryside and remote roads.',
    },
    {
      settings: ['remote'],
      minSharePercent: 15,
      rationale: 'Hard needs genuinely isolated locations, not just villages.',
    },
    {
      settings: ['landmark'],
      maxSharePercent: 10,
      rationale: 'A famous landmark is never a hard guess.',
    },
  ],
};

/**
 * Verification requirements.
 *
 * Every location must have a Street View panorama that was actually confirmed
 * to exist, recorded as a resolved `panoId` plus the date it was checked.
 * Coverage is withdrawn and re-shot over time, so a verification has an age.
 */
export const VERIFICATION_GATES = {
  /** Share of catalog entries that must carry a verified panorama id. */
  minVerifiedPercent: 100,
  /**
   * Verifications older than this are reported as stale. Not a release
   * blocker — stale is not the same as broken — but it drives re-verification
   * runs, and a large stale fraction is a signal the catalog needs a sweep.
   */
  staleAfterDays: 365,
} as const;

/** Every gate, for documentation and for the audit's summary table. */
export const RELEASE_GATES = {
  minGroupsByDifficulty: MIN_GROUPS_BY_DIFFICULTY,
  minTotalGroups: MIN_TOTAL_GROUPS,
  breadth: BREADTH_GATES,
  concentration: CONCENTRATION_GATES,
  settingRules: SETTING_RULES,
  verification: VERIFICATION_GATES,
} as const;

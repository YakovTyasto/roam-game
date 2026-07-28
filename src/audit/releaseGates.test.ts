import { describe, expect, it } from 'vitest';
import type { CatalogLocation } from '../types';
import type { Continent } from '../config/geography';
import type { Difficulty } from '../config/difficulty';
import type { LocationSetting } from '../config/releaseGates';
import { MIN_GROUPS_BY_DIFFICULTY, MIN_TOTAL_GROUPS } from '../config/releaseGates';
import { COUNTRY_CONTINENT } from '../config/geography';
import { auditDataset } from './datasetAudit';
import { evaluateReleaseGates } from './releaseGates';
import { LOCATIONS } from '../data/locations';

/**
 * Real, mapped countries grouped by continent. The fixture must use countries
 * the geography table knows, or every row trips `country.unknown` — which is
 * the validator working correctly, not a fixture convenience to bypass.
 */
const COUNTRIES_BY_CONTINENT = (() => {
  const grouped = new Map<Continent, string[]>();
  for (const [country, continent] of Object.entries(COUNTRY_CONTINENT)) {
    const list = grouped.get(continent);
    if (list) list.push(country);
    else grouped.set(continent, [country]);
  }
  return grouped;
})();

const CONTINENTS: readonly Continent[] = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
];

/**
 * Build a catalog that clears every gate, so individual gates can be broken one
 * at a time and observed in isolation. Coordinates are on a coarse grid, well
 * beyond the cluster threshold, and each location gets its own country.
 */
function passingCatalog(): CatalogLocation[] {
  const out: CatalogLocation[] = [];
  const perTier: Record<Difficulty, { count: number; settings: LocationSetting[] }> = {
    // Easy: ≥35% landmark, ≥80% landmark+urban, ≤5% remote.
    easy: { count: 80, settings: ['landmark', 'landmark', 'landmark', 'urban', 'suburban'] },
    // Normal: ≥25% urban, ≥20% suburban, ≥15% rural/remote, ≤20% landmark.
    normal: { count: 140, settings: ['urban', 'urban', 'suburban', 'rural', 'landmark'] },
    // Hard: ≥45% rural/remote, ≥15% remote, ≤10% landmark.
    hard: { count: 80, settings: ['rural', 'remote', 'remote', 'suburban', 'urban'] },
  };

  let index = 0;
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const { count, settings } = perTier[difficulty];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(index / 18);
      const continent = CONTINENTS[index % CONTINENTS.length];
      const pool = COUNTRIES_BY_CONTINENT.get(continent)!;
      out.push({
        id: `gate-${difficulty}-${i}`,
        lat: -80 + (row % 17) * 9,
        lng: -175 + (index % 18) * 19,
        label: `Gate ${difficulty} ${i}`,
        // Spread across every mapped country in the continent so no single
        // country approaches the 10% share cap.
        country: pool[Math.floor(index / CONTINENTS.length) % pool.length],
        continent,
        difficulty,
        tags: [],
        setting: settings[i % settings.length],
        panoId: `PANO_${index}`,
        panoVerifiedAt: new Date().toISOString().slice(0, 10),
      });
      index += 1;
    }
  }
  return out;
}

const gatesFor = (catalog: CatalogLocation[]) => evaluateReleaseGates(auditDataset(catalog));
const gate = (catalog: CatalogLocation[], id: string) =>
  gatesFor(catalog).gates.find((g) => g.id === id)!;

describe('release gate thresholds', () => {
  it('matches the agreed release minimums', () => {
    expect(MIN_GROUPS_BY_DIFFICULTY).toEqual({ easy: 80, normal: 140, hard: 80 });
    expect(MIN_TOTAL_GROUPS).toBe(300);
  });
});

describe('size gates', () => {
  it('fails when a tier is short and reports the exact shortfall', () => {
    const catalog = passingCatalog().filter(
      (l) => !(l.difficulty === 'normal' && l.id.endsWith('9')),
    );
    const report = gatesFor(catalog);
    const normal = report.gates.find((g) => g.id === 'size.normal')!;
    expect(normal.passed).toBe(false);
    expect(normal.shortfall).toBe(report.groupsStillNeeded.normal);
    expect(report.groupsStillNeeded.normal).toBeGreaterThan(0);
  });

  it('measures a tier on its own groups, not the fallback-widened pool', () => {
    // A tiny Hard tier borrows from Normal during play, but borrowing is not
    // growth: the gate must still fail.
    const catalog = passingCatalog().filter((l) => l.difficulty !== 'hard');
    expect(gate(catalog, 'size.hard').passed).toBe(false);
    expect(gate(catalog, 'size.hard').actual).toBe('0');
  });

  it('checks the total independently of the tiers', () => {
    const full = passingCatalog();
    expect(gate(full, 'size.total').passed).toBe(true);
    expect(gate(full.slice(0, 299), 'size.total').passed).toBe(false);
  });

  it('does not let rows that share a canonical group pad the total', () => {
    const catalog = passingCatalog();
    // Duplicate one location at the same coordinates: 301 rows, still 300 places.
    catalog.push({ ...catalog[0], id: 'padding-row' });
    const report = gatesFor(catalog);
    expect(report.gates.find((g) => g.id === 'size.total')!.actual).toBe('300');
    expect(report.gates.find((g) => g.id === 'integrity.redundantGroups')!.passed).toBe(false);
  });
});

describe('breadth gates', () => {
  it('passes on a broad catalog', () => {
    const catalog = passingCatalog();
    expect(gate(catalog, 'breadth.countries').passed).toBe(true);
    expect(gate(catalog, 'breadth.continents').passed).toBe(true);
    expect(gate(catalog, 'breadth.continentDepth').passed).toBe(true);
  });

  it('fails when too few countries are represented', () => {
    const catalog = passingCatalog().map((l) => ({ ...l, country: 'Japan', continent: 'Asia' as const }));
    expect(gate(catalog, 'breadth.countries').passed).toBe(false);
  });

  it('fails when a continent is represented by only a token location', () => {
    // One lonely Oceania location, everything else in Europe.
    const catalog = passingCatalog().map((l, i) =>
      i === 0
        ? { ...l, country: 'Fiji', continent: 'Oceania' as const }
        : { ...l, country: 'France', continent: 'Europe' as const },
    );
    const depth = gate(catalog, 'breadth.continentDepth');
    expect(depth.passed).toBe(false);
    expect(depth.actual).toContain('1');
  });
});

describe('concentration gates', () => {
  it('fails when one country dominates the catalog', () => {
    const catalog = passingCatalog().map((l, i) =>
      i % 3 === 0 ? { ...l, country: 'United States', continent: 'North America' as const } : l,
    );
    const country = gate(catalog, 'concentration.country');
    expect(country.passed).toBe(false);
    expect(country.actual).toContain('United States');
  });

  it('fails when too many locations sit inside one city-sized cluster', () => {
    const catalog = passingCatalog();
    for (let i = 0; i < 4; i++) {
      catalog.push({
        ...catalog[0],
        id: `crowded-${i}`,
        lat: 12 + i * 0.05,
        lng: 34,
        panoId: `PANO_CROWD_${i}`,
      });
    }
    expect(gate(catalog, 'concentration.cluster').passed).toBe(false);
  });
});

describe('integrity gates', () => {
  it('fails on duplicate panorama ids', () => {
    const catalog = passingCatalog();
    catalog[1] = { ...catalog[1], panoId: catalog[0].panoId };
    expect(gate(catalog, 'integrity.duplicatePanoIds').passed).toBe(false);
  });

  it('fails on near-duplicate coordinates', () => {
    const catalog = passingCatalog();
    catalog.push({
      ...catalog[0],
      id: 'too-close',
      lat: catalog[0].lat + 0.001,
      panoId: 'PANO_CLOSE',
    });
    expect(gate(catalog, 'integrity.nearDuplicates').passed).toBe(false);
  });

  it('fails when metadata is incomplete', () => {
    const catalog = passingCatalog();
    catalog[0] = { ...catalog[0], setting: undefined as unknown as LocationSetting };
    expect(gate(catalog, 'integrity.metadata').passed).toBe(false);
  });
});

describe('verification gates', () => {
  it('fails when any location lacks a verified panorama', () => {
    const catalog = passingCatalog();
    catalog[0] = { ...catalog[0], panoId: undefined };
    const streetView = gate(catalog, 'verification.streetView');
    expect(streetView.passed).toBe(false);
    expect(streetView.shortfall).toBe(1);
  });

  it('fails when a verification has no date', () => {
    const catalog = passingCatalog();
    catalog[0] = { ...catalog[0], panoVerifiedAt: undefined };
    expect(gate(catalog, 'verification.dated').passed).toBe(false);
  });

  it('reports stale verifications without blocking release', () => {
    const catalog = passingCatalog();
    catalog[0] = { ...catalog[0], panoVerifiedAt: '2020-01-01' };
    const report = auditDataset(catalog);
    expect(report.verification.stale).toBe(1);
    // Stale is a re-check signal, not a blocker.
    expect(evaluateReleaseGates(report).gates.find((g) => g.id === 'verification.dated')!.passed).toBe(
      true,
    );
  });
});

describe('balance gates', () => {
  it('fails a Hard tier made of city centres and landmarks', () => {
    // This is precisely the shape of the pre-V4 catalog.
    const catalog = passingCatalog().map((l) =>
      l.difficulty === 'hard' ? { ...l, setting: 'urban' as LocationSetting } : l,
    );
    expect(gate(catalog, 'balance.hard.rural-remote.min').passed).toBe(false);
    expect(gate(catalog, 'balance.hard.remote.min').passed).toBe(false);
  });

  it('fails a Normal tier stuffed with landmarks', () => {
    const catalog = passingCatalog().map((l) =>
      l.difficulty === 'normal' ? { ...l, setting: 'landmark' as LocationSetting } : l,
    );
    expect(gate(catalog, 'balance.normal.landmark.max').passed).toBe(false);
  });

  it('fails an Easy tier with no landmarks', () => {
    const catalog = passingCatalog().map((l) =>
      l.difficulty === 'easy' ? { ...l, setting: 'rural' as LocationSetting } : l,
    );
    expect(gate(catalog, 'balance.easy.landmark.min').passed).toBe(false);
  });

  it('passes a well-balanced catalog', () => {
    const balance = gatesFor(passingCatalog()).gates.filter((g) => g.category === 'balance');
    expect(balance.every((g) => g.passed)).toBe(true);
  });
});

describe('the full gate report', () => {
  it('passes for a catalog built to the gates', () => {
    const report = gatesFor(passingCatalog());
    const failures = report.gates.filter((g) => !g.passed);
    expect(failures.map((f) => `${f.id}: ${f.actual}`)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.groupsStillNeeded).toEqual({ easy: 0, normal: 0, hard: 0, total: 0 });
  });

  it('summarises pass/fail by category', () => {
    const report = gatesFor(passingCatalog());
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(report.summary.total);
    expect(report.summary.byCategory.size.failed).toBe(0);
  });
});

describe('the shipped catalog', () => {
  const report = gatesFor([...LOCATIONS]);

  it('is blocked from release, and says so', () => {
    // The catalog is far below the V4 release gates. This test exists to make
    // that impossible to forget: if the catalog is expanded to clear the gates,
    // update it deliberately.
    expect(report.passed).toBe(false);
  });

  it('reports the exact expansion still required', () => {
    // Derived from the catalog rather than hard-coded, so a verified batch
    // landing does not require editing this test — but the arithmetic itself
    // is still asserted, and every tier must still be short.
    const audit = auditDataset([...LOCATIONS]);
    const own = (d: Difficulty) =>
      audit.byDifficulty.find((t) => t.difficulty === d)!.ownGroups;

    // A tier that has met its floor reports 0, not a negative surplus.
    // Batches 007-009 took normal, hard and the total past their floors, so
    // this now asserts the clamp as well as the arithmetic.
    const short = (needed: number, have: number) => Math.max(0, needed - have);
    expect(report.groupsStillNeeded).toEqual({
      easy: short(MIN_GROUPS_BY_DIFFICULTY.easy, own('easy')),
      normal: short(MIN_GROUPS_BY_DIFFICULTY.normal, own('normal')),
      hard: short(MIN_GROUPS_BY_DIFFICULTY.hard, own('hard')),
      total: short(MIN_TOTAL_GROUPS, audit.totals.canonicalGroups),
    });
    for (const value of Object.values(report.groupsStillNeeded)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
    // Easy is the last tier short of its floor.
    expect(report.groupsStillNeeded.easy).toBeGreaterThan(0);
  });

  it('fails on easy size alone — not on duplication, verification or balance', () => {
    const failed = new Set(report.gates.filter((g) => !g.passed).map((g) => g.id));
    // Batches 007-009 cleared normal, hard and the total. Easy came in two
    // groups short of its floor and is the single remaining blocker.
    expect(failed).toEqual(new Set(['size.easy']));
    // Every other gate is still evaluated. Batch 005 lifted the last continent
    // past its depth floor, batch 006 the last balance floor, and repair-006
    // took verification to 100% — none of them may drop back unnoticed.
    const evaluated = report.gates.map((g) => g.id);
    expect(evaluated).toContain('breadth.continentDepth');
    expect(evaluated).toContain('balance.normal.urban.min');
    expect(evaluated).toContain('verification.streetView');
    expect(evaluated).toContain('integrity.metadata');
    // Deduplication was never the problem, and still isn't.
    expect(failed).not.toContain('integrity.duplicatePanoIds');
    expect(failed).not.toContain('integrity.nearDuplicates');
    expect(failed).not.toContain('integrity.redundantGroups');
  });
});

import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import {
  type Candidate,
  renderCatalogEntries,
  toCatalogLocation,
  validateCandidateBatch,
} from './candidates';
import { LOCATIONS } from '../data/locations';
import { auditDataset } from '../audit/datasetAudit';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'test-place',
    lat: 45,
    lng: 90,
    label: 'Test Place',
    country: 'Japan',
    difficulty: 'normal',
    setting: 'suburban',
    tags: [],
    source: 'unit test',
    ...overrides,
  };
}

const emptyCatalog: GameLocation[] = [];

const codes = (result: { issues: { code: string }[] }) => result.issues.map((i) => i.code);

describe('validateCandidateBatch — shape', () => {
  it('accepts a well-formed candidate', () => {
    const report = validateCandidateBatch([candidate()], emptyCatalog);
    expect(report.accepted).toHaveLength(1);
    expect(report.results[0].issues).toEqual([]);
  });

  it('rejects a missing or malformed id', () => {
    const report = validateCandidateBatch(
      [candidate({ id: '' }), candidate({ id: 'Not Kebab Case' })],
      emptyCatalog,
    );
    expect(codes(report.results[0])).toContain('id.missing');
    expect(codes(report.results[1])).toContain('id.format');
    expect(report.accepted).toHaveLength(0);
  });

  it('rejects invalid coordinates and Null Island', () => {
    const report = validateCandidateBatch(
      [candidate({ id: 'a', lat: 999 }), candidate({ id: 'b', lat: 0, lng: 0 })],
      emptyCatalog,
    );
    expect(codes(report.results[0])).toContain('coordinates.invalid');
    expect(codes(report.results[1])).toContain('coordinates.nullIsland');
  });

  it('rejects a missing label', () => {
    const report = validateCandidateBatch([candidate({ label: '' })], emptyCatalog);
    expect(codes(report.results[0])).toContain('label.missing');
  });

  it('warns, but does not reject, when the source note is missing', () => {
    const report = validateCandidateBatch([candidate({ source: undefined })], emptyCatalog);
    expect(codes(report.results[0])).toContain('source.missing');
    expect(report.results[0].accepted).toBe(true);
  });
});

describe('validateCandidateBatch — metadata', () => {
  it('rejects an invalid difficulty or setting', () => {
    const report = validateCandidateBatch(
      [candidate({ id: 'a', difficulty: 'brutal' }), candidate({ id: 'b', setting: 'underwater' })],
      emptyCatalog,
    );
    expect(codes(report.results[0])).toContain('difficulty.invalid');
    expect(codes(report.results[1])).toContain('setting.invalid');
  });

  it('rejects derived collections used as hand-written tags', () => {
    const report = validateCandidateBatch(
      [candidate({ tags: ['islands'] })],
      emptyCatalog,
    );
    expect(codes(report.results[0])).toContain('tags.invalid');
  });

  it('accepts curated tags', () => {
    const report = validateCandidateBatch(
      [candidate({ tags: ['capitals', 'famous'] })],
      emptyCatalog,
    );
    expect(report.results[0].accepted).toBe(true);
  });

  it('rejects a country with no continent mapping rather than guessing', () => {
    const report = validateCandidateBatch([candidate({ country: 'Atlantis' })], emptyCatalog);
    expect(codes(report.results[0])).toContain('country.unknown');
  });

  it('rejects a continent that disagrees with the country table', () => {
    const report = validateCandidateBatch(
      [candidate({ country: 'Japan', continent: 'Europe' })],
      emptyCatalog,
    );
    expect(codes(report.results[0])).toContain('continent.mismatch');
  });

  it('accepts a continent that agrees', () => {
    const report = validateCandidateBatch(
      [candidate({ country: 'Japan', continent: 'Asia' })],
      emptyCatalog,
    );
    expect(report.results[0].accepted).toBe(true);
  });
});

describe('validateCandidateBatch — novelty', () => {
  const catalog: GameLocation[] = [
    {
      id: 'existing',
      lat: 48.8584,
      lng: 2.2945,
      label: 'Existing',
      country: 'France',
      difficulty: 'easy',
    },
  ];

  it('rejects an id already in the catalog', () => {
    const report = validateCandidateBatch([candidate({ id: 'existing' })], catalog);
    expect(codes(report.results[0])).toContain('id.duplicateCatalog');
  });

  it('rejects a duplicate id inside one batch', () => {
    const report = validateCandidateBatch(
      [candidate({ id: 'twin', lat: 10, lng: 10 }), candidate({ id: 'twin', lat: 40, lng: 40 })],
      emptyCatalog,
    );
    expect(codes(report.results[1])).toContain('id.duplicateBatch');
  });

  it('rejects a coordinate that is the same canonical place as a catalog entry', () => {
    const report = validateCandidateBatch(
      [candidate({ id: 'near', lat: 48.8586, lng: 2.2947, country: 'France' })],
      catalog,
    );
    expect(codes(report.results[0])).toContain('novelty.catalogDuplicate');
  });

  it('rejects two candidates in one batch that are the same place', () => {
    const report = validateCandidateBatch(
      [
        candidate({ id: 'a', lat: 35.0, lng: 135.0 }),
        candidate({ id: 'b', lat: 35.001, lng: 135.0 }),
      ],
      emptyCatalog,
    );
    expect(report.results[0].accepted).toBe(true);
    expect(codes(report.results[1])).toContain('novelty.batchDuplicate');
  });

  it('accepts two genuinely different districts of one city', () => {
    // ~6.7 km apart: one cluster for the soft diversity rules, two places for
    // uniqueness. Collapsing these would shrink the pool for no benefit.
    const report = validateCandidateBatch(
      [
        candidate({ id: 'district-a', lat: 51.5007, lng: -0.1246, country: 'United Kingdom' }),
        candidate({ id: 'district-b', lat: 51.5074, lng: -0.0278, country: 'United Kingdom' }),
      ],
      emptyCatalog,
    );
    expect(report.accepted).toHaveLength(2);
  });

  it('warns when an explicit location group is declared', () => {
    const report = validateCandidateBatch(
      [candidate({ locationGroupId: 'some-landmark' })],
      emptyCatalog,
    );
    expect(codes(report.results[0])).toContain('group.explicit');
    expect(report.results[0].accepted).toBe(true);
  });
});

describe('validateCandidateBatch — concentration', () => {
  it('rejects a candidate that would overload one 25 km cluster', () => {
    // Three already in the cluster is the limit, so a fourth must be refused.
    const near = (n: number) => ({ lat: 35 + n * 0.05, lng: 139 });
    const catalog: GameLocation[] = [0, 1, 2].map((n) => ({
      id: `city-${n}`,
      ...near(n),
      label: `City ${n}`,
      country: 'Japan',
      difficulty: 'normal' as const,
    }));
    const report = validateCandidateBatch(
      [candidate({ id: 'city-3', ...near(3) })],
      catalog,
    );
    expect(codes(report.results[0])).toContain('concentration.cluster');
  });

  it('counts earlier accepted candidates in the same batch', () => {
    const near = (n: number) => ({ lat: 35 + n * 0.05, lng: 139 });
    const report = validateCandidateBatch(
      [0, 1, 2, 3].map((n) => candidate({ id: `city-${n}`, ...near(n) })),
      emptyCatalog,
    );
    // The first three are fine; the fourth pushes the cluster over the limit.
    expect(report.results.slice(0, 3).every((r) => r.accepted)).toBe(true);
    expect(codes(report.results[3])).toContain('concentration.cluster');
  });

  it('does not penalise well-separated candidates', () => {
    const report = validateCandidateBatch(
      [
        candidate({ id: 'a', lat: 10, lng: 10, country: 'Kenya' }),
        candidate({ id: 'b', lat: 40, lng: 40, country: 'Japan' }),
        candidate({ id: 'c', lat: -30, lng: 140, country: 'Australia' }),
      ],
      emptyCatalog,
    );
    expect(report.accepted).toHaveLength(3);
  });
});

describe('validateCandidateBatch — reporting', () => {
  it('counts issues by code', () => {
    const report = validateCandidateBatch(
      [candidate({ id: 'a', country: 'Atlantis' }), candidate({ id: 'b', country: 'Narnia' })],
      emptyCatalog,
    );
    expect(report.issueCounts['country.unknown']).toBe(2);
  });

  it('partitions accepted and rejected', () => {
    const report = validateCandidateBatch(
      [candidate({ id: 'good' }), candidate({ id: 'bad', difficulty: 'nope' })],
      emptyCatalog,
    );
    expect(report.accepted.map((r) => r.candidate.id)).toEqual(['good']);
    expect(report.rejected.map((r) => r.candidate.id)).toEqual(['bad']);
    expect(report.batchSize).toBe(2);
  });
});

describe('toCatalogLocation', () => {
  const verified = {
    candidate: candidate({ tags: ['famous'] }),
    panoId: 'PANO_ABC',
    verifiedAt: '2026-07-26',
    offsetKm: 0.012,
  };

  it('builds a complete catalog entry from a verified candidate', () => {
    const entry = toCatalogLocation(verified);
    expect(entry).toMatchObject({
      id: 'test-place',
      country: 'Japan',
      continent: 'Asia',
      difficulty: 'normal',
      setting: 'suburban',
      tags: ['famous'],
      panoId: 'PANO_ABC',
      panoVerifiedAt: '2026-07-26',
    });
  });

  it('derives the continent rather than trusting the candidate', () => {
    const entry = toCatalogLocation({
      ...verified,
      candidate: candidate({ country: 'Brazil', continent: 'Asia' }),
    });
    expect(entry.continent).toBe('South America');
  });

  it('refuses a country with no continent mapping', () => {
    expect(() =>
      toCatalogLocation({ ...verified, candidate: candidate({ country: 'Atlantis' }) }),
    ).toThrow(/continent mapping/);
  });

  it('refuses invalid metadata', () => {
    expect(() =>
      toCatalogLocation({ ...verified, candidate: candidate({ setting: 'nope' }) }),
    ).toThrow(/invalid metadata/);
  });

  it('carries an explicit location group through', () => {
    const entry = toCatalogLocation({
      ...verified,
      candidate: candidate({ locationGroupId: 'landmark-x' }),
    });
    expect(entry.locationGroupId).toBe('landmark-x');
  });

  it('produces entries the audit accepts without metadata issues', () => {
    // The real contract: anything this function emits must satisfy every
    // metadata check the catalog audit applies.
    const entry = toCatalogLocation(verified);
    const report = auditDataset([entry]);
    expect(report.metadataIssues).toEqual([]);
  });
});

describe('renderCatalogEntries', () => {
  it('renders a pasteable line per entry', () => {
    const rendered = renderCatalogEntries([
      toCatalogLocation({
        candidate: candidate({ tags: ['capitals'] }),
        panoId: 'PANO_1',
        verifiedAt: '2026-07-26',
        offsetKm: 0,
      }),
    ]);
    expect(rendered).toContain("id: 'test-place'");
    expect(rendered).toContain("panoId: 'PANO_1'");
    expect(rendered).toContain("panoVerifiedAt: '2026-07-26'");
    expect(rendered).toContain("setting: 'suburban'");
    // Indented and comma-terminated, so it pastes straight into the array.
    expect(rendered.startsWith('  {')).toBe(true);
    expect(rendered.trimEnd().endsWith('},')).toBe(true);
  });

  it('escapes apostrophes in labels', () => {
    const rendered = renderCatalogEntries([
      toCatalogLocation({
        candidate: candidate({ label: "Land's End" }),
        panoId: 'P',
        verifiedAt: '2026-07-26',
        offsetKm: 0,
      }),
    ]);
    expect(rendered).toContain("label: 'Land\\'s End'");
  });
});

describe('the shipped catalog as a validation baseline', () => {
  it('rejects every existing location as a candidate — nothing is silently re-addable', () => {
    const asCandidates: Candidate[] = LOCATIONS.slice(0, 5).map((l) => ({
      id: l.id,
      lat: l.lat,
      lng: l.lng,
      label: l.label,
      country: l.country,
      difficulty: l.difficulty,
      setting: l.setting,
      source: 'existing',
    }));
    const report = validateCandidateBatch(asCandidates, LOCATIONS);
    expect(report.accepted).toHaveLength(0);
  });
});

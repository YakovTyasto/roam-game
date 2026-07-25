import { describe, expect, it } from 'vitest';
import { buildResumeData, computeRemainingSeconds, parseActiveSoloRun } from './resume';

function rawRound(overrides: Record<string, unknown> = {}) {
  return {
    round_number: 1,
    location_id: 'loc-1',
    pano_id: 'pano-1',
    heading: 90,
    pitch: 0,
    zoom: 0,
    status: 'active',
    started_at: '2024-01-01T00:00:00Z',
    label: null,
    country: null,
    lat: null,
    lng: null,
    guess_lat: null,
    guess_lng: null,
    distance_km: null,
    score: null,
    ...overrides,
  };
}

function rawRun(rounds: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    run_id: 'run-1',
    difficulty: 'normal',
    total_rounds: rounds.length,
    round_duration_seconds: 120,
    current_round: 1,
    total_score: 0,
    server_now: '2024-01-01T00:00:00Z',
    rounds,
    ...overrides,
  };
}

describe('parseActiveSoloRun', () => {
  it('returns null when there is no active run', () => {
    expect(parseActiveSoloRun({ active: false })).toBeNull();
  });

  it('returns null for non-object / undefined input', () => {
    expect(parseActiveSoloRun(null)).toBeNull();
    expect(parseActiveSoloRun(undefined)).toBeNull();
    expect(parseActiveSoloRun('nonsense')).toBeNull();
  });

  it('parses a valid single-round payload', () => {
    const run = parseActiveSoloRun(rawRun([rawRound()]));
    expect(run).not.toBeNull();
    expect(run!.runId).toBe('run-1');
    expect(run!.rounds).toHaveLength(1);
    expect(run!.rounds[0].panoId).toBe('pano-1');
  });

  it('fails safe (returns null) on a corrupted/stale-shaped payload', () => {
    // Missing required fields, wrong types, unknown difficulty — none of
    // these should throw; all must resolve to "nothing to resume".
    expect(parseActiveSoloRun(rawRun([rawRound()], { difficulty: 'extreme' }))).toBeNull();
    expect(parseActiveSoloRun(rawRun([rawRound()], { run_id: 42 }))).toBeNull();
    expect(parseActiveSoloRun(rawRun([rawRound()], { rounds: 'not-an-array' }))).toBeNull();
    expect(parseActiveSoloRun(rawRun([{ round_number: 1 }]))).toBeNull(); // round missing pano_id
    expect(parseActiveSoloRun({})).toBeNull();
  });
});

describe('computeRemainingSeconds', () => {
  it('returns the full duration when the round has not started', () => {
    expect(computeRemainingSeconds(null, 120, '2024-01-01T00:02:00Z')).toBe(120);
  });

  it('subtracts elapsed server time', () => {
    expect(
      computeRemainingSeconds('2024-01-01T00:00:00Z', 120, '2024-01-01T00:00:30Z'),
    ).toBe(90);
  });

  it('clamps to 0 rather than restoring an expired round as if time remains', () => {
    expect(
      computeRemainingSeconds('2024-01-01T00:00:00Z', 120, '2024-01-01T00:05:00Z'),
    ).toBe(0);
  });

  it('returns exactly 0 at the boundary', () => {
    expect(
      computeRemainingSeconds('2024-01-01T00:00:00Z', 120, '2024-01-01T00:02:00Z'),
    ).toBe(0);
  });

  it('fails safe to the full duration on an unparseable timestamp', () => {
    expect(computeRemainingSeconds('not-a-date', 120, '2024-01-01T00:00:00Z')).toBe(120);
  });
});

describe('buildResumeData', () => {
  it('resumes before any guess: no results, full timer, current round by pano id only', () => {
    const run = parseActiveSoloRun(
      rawRun([rawRound({ round_number: 1, status: 'active', started_at: '2024-01-01T00:00:00Z' })], {
        current_round: 1,
        server_now: '2024-01-01T00:00:10Z',
      }),
    )!;
    const data = buildResumeData(run);
    expect(data.results).toEqual([]);
    expect(data.roundIndex).toBe(0);
    expect(data.currentPanorama).toEqual({
      locationId: 'loc-1',
      panoId: 'pano-1',
      heading: 90,
      pitch: 0,
      zoom: 0,
    });
    expect(data.remainingSeconds).toBe(110);
    expect(data.awaitingFinalize).toBe(false);
  });

  it('resumes after one guess: one reconstructed result, second round pending', () => {
    const raw = rawRun(
      [
        rawRound({
          round_number: 1,
          status: 'complete',
          label: 'Paris',
          country: 'France',
          lat: 48.85,
          lng: 2.35,
          guess_lat: 48.0,
          guess_lng: 2.0,
          distance_km: 100,
          score: 4700,
        }),
        rawRound({ round_number: 2, location_id: 'loc-2', pano_id: 'pano-2', status: 'active', started_at: '2024-01-01T00:05:00Z' }),
      ],
      { current_round: 2, total_score: 4700, server_now: '2024-01-01T00:05:05Z' },
    );
    const run = parseActiveSoloRun(raw)!;
    const data = buildResumeData(run);

    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toEqual({
      location: { id: 'loc-1', lat: 48.85, lng: 2.35, label: 'Paris', country: 'France', difficulty: 'normal' },
      guess: { lat: 48.0, lng: 2.0 },
      distanceKm: 100,
      score: 4700,
    });
    expect(data.roundIndex).toBe(1);
    expect(data.currentPanorama?.panoId).toBe('pano-2');
    expect(data.remainingSeconds).toBe(115);
  });

  it('a round already finalized (complete) never reappears as pending', () => {
    const raw = rawRun([
      rawRound({ round_number: 1, status: 'complete', label: 'A', country: 'A', lat: 1, lng: 1, score: 100, distance_km: 1 }),
    ]);
    const run = parseActiveSoloRun(raw)!;
    const data = buildResumeData(run);
    expect(data.currentPanorama).toBeNull();
    expect(data.results).toHaveLength(1);
  });

  it('flags a fully-guessed run as awaiting finalize (never re-scored)', () => {
    const raw = rawRun(
      [
        rawRound({ round_number: 1, status: 'complete', label: 'A', country: 'A', lat: 1, lng: 1, score: 100, distance_km: 1 }),
        rawRound({ round_number: 2, location_id: 'loc-2', pano_id: 'pano-2', status: 'complete', label: 'B', country: 'B', lat: 2, lng: 2, score: 200, distance_km: 2 }),
      ],
      { current_round: 3, total_score: 300 },
    );
    const run = parseActiveSoloRun(raw)!;
    const data = buildResumeData(run);
    expect(data.awaitingFinalize).toBe(true);
    expect(data.currentPanorama).toBeNull();
    expect(data.results).toHaveLength(2);
  });
});

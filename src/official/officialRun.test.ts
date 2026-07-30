import { describe, expect, it } from 'vitest';
import {
  awaitingFinalize,
  hiddenPanoramasOf,
  nextRoundIndex,
  parseOfficialRun,
  remainingSeconds,
  resultsOf,
} from './officialRun';

/**
 * The parser is the client half of the answer-secrecy boundary, so most of these
 * tests are about what must NOT come through: an un-guessed round may never
 * produce a location the UI could reveal, however the payload is shaped.
 */

const activeRound = (n: number) => ({
  round_number: n,
  status: n === 1 ? 'active' : 'pending',
  pano_id: `PANO_${n}`,
  heading: 90,
  pitch: 0,
  zoom: 0,
  expires_at: '2026-07-30T12:02:00Z',
  // The server omits these entirely for an un-guessed round; JSON nulls are what
  // arrive over the wire when a `case … then … end` yields no value.
  location_id: null,
  label: null,
  country: null,
  lat: null,
  lng: null,
  guess_lat: null,
  guess_lng: null,
  distance_km: null,
  score: null,
});

const completedRound = (n: number) => ({
  round_number: n,
  status: 'complete',
  pano_id: `PANO_${n}`,
  heading: 12,
  pitch: 0,
  zoom: 0,
  expires_at: '2026-07-30T12:00:00Z',
  location_id: 'paris-eiffel',
  label: 'Champ de Mars, Paris',
  country: 'France',
  lat: 48.8584,
  lng: 2.2945,
  guess_lat: 48.85,
  guess_lng: 2.3,
  distance_km: 1.2,
  score: 4990,
});

const payload = (rounds: unknown[], overrides: Record<string, unknown> = {}) => ({
  found: true,
  run_id: 'run-1',
  mode: 'solo',
  difficulty: 'normal',
  total_rounds: rounds.length,
  round_duration_seconds: 120,
  current_round: 1,
  total_score: 0,
  status: 'active',
  server_selected: true,
  server_now: '2026-07-30T12:00:00Z',
  rounds,
  ...overrides,
});

describe('parseOfficialRun', () => {
  it('parses a fresh server-selected run', () => {
    const run = parseOfficialRun(payload([activeRound(1), activeRound(2)]));
    expect(run).not.toBeNull();
    expect(run!.runId).toBe('run-1');
    expect(run!.serverSelected).toBe(true);
    expect(run!.difficulty).toBe('normal');
    expect(run!.rounds).toHaveLength(2);
    expect(run!.rounds[0].panorama).toEqual({ panoId: 'PANO_1', heading: 90, pitch: 0, zoom: 0 });
  });

  it('never produces a result for a round that is not complete', () => {
    const run = parseOfficialRun(payload([activeRound(1), activeRound(2)]))!;
    expect(run.rounds.every((r) => r.result === null)).toBe(true);
    expect(resultsOf(run)).toEqual([]);
  });

  it('ignores an answer smuggled onto an un-guessed round', () => {
    // Defence in depth: even if a future server change (or a tampered response)
    // leaked coordinates for an active round, the client must not surface them.
    const leaky = { ...activeRound(1), lat: 48.8584, lng: 2.2945, country: 'France' };
    const run = parseOfficialRun(payload([leaky]))!;
    expect(run.rounds[0].result).toBeNull();
  });

  it('requires both the answer and the guess before reporting a result', () => {
    const halfDone = { ...completedRound(1), guess_lat: null, guess_lng: null };
    const run = parseOfficialRun(payload([halfDone]))!;
    expect(run.rounds[0].result).toBeNull();
  });

  it('parses a completed round into a full result', () => {
    const run = parseOfficialRun(payload([completedRound(1)]))!;
    const result = run.rounds[0].result!;
    expect(result.score).toBe(4990);
    expect(result.distanceKm).toBeCloseTo(1.2);
    expect(result.location.country).toBe('France');
    expect(result.guess).toEqual({ lat: 48.85, lng: 2.3 });
  });

  it('returns null for "no active run" rather than throwing', () => {
    expect(parseOfficialRun({ found: false })).toBeNull();
    expect(parseOfficialRun(null)).toBeNull();
    expect(parseOfficialRun('nonsense')).toBeNull();
    expect(parseOfficialRun([])).toBeNull();
  });

  it('rejects a payload with no run id or no rounds count', () => {
    expect(parseOfficialRun(payload([activeRound(1)], { run_id: null }))).toBeNull();
    expect(parseOfficialRun(payload([activeRound(1)], { total_rounds: 0 }))).toBeNull();
  });

  it('falls back to safe defaults for unknown enum values', () => {
    const run = parseOfficialRun(
      payload([activeRound(1)], { mode: 'wat', difficulty: 'impossible', status: 'weird' }),
    )!;
    expect(run.mode).toBe('solo');
    expect(run.difficulty).toBe('normal');
    expect(run.status).toBe('active');
  });

  it('sorts rounds by number regardless of payload order', () => {
    const run = parseOfficialRun(payload([activeRound(2), activeRound(1)]))!;
    expect(run.rounds.map((r) => r.roundNumber)).toEqual([1, 2]);
  });
});

describe('hiddenPanoramasOf', () => {
  it('covers every un-played round and nothing else', () => {
    const run = parseOfficialRun(payload([completedRound(1), activeRound(2), activeRound(3)]))!;
    const hidden = hiddenPanoramasOf(run);
    expect(Object.keys(hidden)).toEqual(['1', '2']);
    expect(hidden[1].panoId).toBe('PANO_2');
  });

  it('keys rounds without leaking the catalog id', () => {
    const run = parseOfficialRun(payload([activeRound(1)]))!;
    // A catalog id would let a client correlate the round against the bundled
    // offline catalog, so the client-side key is synthetic.
    expect(hiddenPanoramasOf(run)[0].locationId).toBe('run-1:1');
  });
});

describe('run progress helpers', () => {
  it('nextRoundIndex points at the first unplayed round', () => {
    const run = parseOfficialRun(payload([completedRound(1), completedRound(2), activeRound(3)]))!;
    expect(nextRoundIndex(run)).toBe(2);
  });

  it('nextRoundIndex runs past the end when everything is played', () => {
    const run = parseOfficialRun(payload([completedRound(1), completedRound(2)]))!;
    expect(nextRoundIndex(run)).toBe(2);
  });

  it('awaitingFinalize only when every round is scored and the run is still active', () => {
    const done = parseOfficialRun(payload([completedRound(1), completedRound(2)]))!;
    expect(awaitingFinalize(done)).toBe(true);

    const partial = parseOfficialRun(payload([completedRound(1), activeRound(2)]))!;
    expect(awaitingFinalize(partial)).toBe(false);

    const finalized = parseOfficialRun(
      payload([completedRound(1), completedRound(2)], { status: 'complete' }),
    )!;
    expect(awaitingFinalize(finalized)).toBe(false);
  });
});

describe('remainingSeconds', () => {
  it('measures the deadline against the SERVER clock, not the device', () => {
    // server_now = 12:00:00, round 1 expires 12:02:00 → 120s, whatever the
    // device thinks the time is.
    const run = parseOfficialRun(payload([activeRound(1)]))!;
    expect(remainingSeconds(run, 0)).toBe(120);
  });

  it('never returns a negative remainder for an expired round', () => {
    const expired = { ...activeRound(1), expires_at: '2026-07-30T11:59:00Z' };
    const run = parseOfficialRun(payload([expired]))!;
    expect(remainingSeconds(run, 0)).toBe(0);
  });

  it('returns null when the round has no deadline', () => {
    const noTimer = { ...activeRound(1), expires_at: null };
    const run = parseOfficialRun(payload([noTimer]))!;
    expect(remainingSeconds(run, 0)).toBeNull();
  });
});

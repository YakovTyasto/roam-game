import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameLocation, RoundResult } from '../types';
import {
  LOCAL_RUN_SNAPSHOT_KEY,
  clearLocalRunSnapshot,
  readLocalRunSnapshot,
  writeLocalRunSnapshot,
} from './localRunSnapshot';

const loc: GameLocation = { id: 'a', lat: 1, lng: 2, label: 'A', country: 'X', difficulty: 'normal' };
const result: RoundResult = { location: loc, guess: { lat: 1, lng: 1 }, distanceKm: 5, score: 4000 };

describe('localRunSnapshot', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a valid snapshot', () => {
    writeLocalRunSnapshot({
      difficulty: 'normal',
      roundCount: 5,
      timerSeconds: 120,
      roundIndex: 2,
      locations: [loc],
      results: [result],
    });
    const read = readLocalRunSnapshot();
    expect(read).not.toBeNull();
    expect(read!.roundIndex).toBe(2);
    expect(read!.results).toEqual([result]);
  });

  it('returns null when nothing is stored', () => {
    expect(readLocalRunSnapshot()).toBeNull();
  });

  it('fails safe on malformed JSON rather than throwing', () => {
    window.localStorage.setItem(LOCAL_RUN_SNAPSHOT_KEY, '{not json');
    expect(readLocalRunSnapshot()).toBeNull();
  });

  it('discards a snapshot with the wrong version', () => {
    window.localStorage.setItem(
      LOCAL_RUN_SNAPSHOT_KEY,
      JSON.stringify({ version: 2, savedAt: new Date().toISOString(), difficulty: 'normal', roundCount: 5, timerSeconds: 120, roundIndex: 0, locations: [], results: [] }),
    );
    expect(readLocalRunSnapshot()).toBeNull();
  });

  it('discards a snapshot with an invalid location shape', () => {
    window.localStorage.setItem(
      LOCAL_RUN_SNAPSHOT_KEY,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        difficulty: 'normal',
        roundCount: 5,
        timerSeconds: 120,
        roundIndex: 0,
        locations: [{ id: 'a' }], // missing lat/lng/label/country/difficulty
        results: [],
      }),
    );
    expect(readLocalRunSnapshot()).toBeNull();
  });

  it('discards a stale snapshot older than 12 hours', () => {
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(
      LOCAL_RUN_SNAPSHOT_KEY,
      JSON.stringify({ version: 1, savedAt: old, difficulty: 'normal', roundCount: 5, timerSeconds: 120, roundIndex: 0, locations: [], results: [] }),
    );
    expect(readLocalRunSnapshot()).toBeNull();
  });

  it('accepts a snapshot just under the staleness threshold', () => {
    const recent = new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(
      LOCAL_RUN_SNAPSHOT_KEY,
      JSON.stringify({ version: 1, savedAt: recent, difficulty: 'normal', roundCount: 5, timerSeconds: 120, roundIndex: 0, locations: [], results: [] }),
    );
    expect(readLocalRunSnapshot()).not.toBeNull();
  });

  it('supports Endless (null roundCount) and No Timer (null timerSeconds)', () => {
    writeLocalRunSnapshot({
      difficulty: 'hard',
      roundCount: null,
      timerSeconds: null,
      roundIndex: 10,
      locations: [loc],
      results: [],
    });
    const read = readLocalRunSnapshot();
    expect(read?.roundCount).toBeNull();
    expect(read?.timerSeconds).toBeNull();
  });

  it('clearLocalRunSnapshot removes the stored value', () => {
    writeLocalRunSnapshot({ difficulty: 'normal', roundCount: 5, timerSeconds: 120, roundIndex: 0, locations: [], results: [] });
    clearLocalRunSnapshot();
    expect(readLocalRunSnapshot()).toBeNull();
  });
});

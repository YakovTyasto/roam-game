import { describe, expect, it } from 'vitest';
import type { GameLocation, RoundResult } from '../types';
import { computeEndlessStats } from './endlessStats';

const LOC: GameLocation = { id: 'x', lat: 0, lng: 0, label: 'X', country: 'X', difficulty: 'normal' };

function result(score: number, distanceKm = 0): RoundResult {
  return { location: LOC, guess: { lat: 0, lng: 0 }, distanceKm, score };
}

describe('computeEndlessStats', () => {
  it('returns zeroed stats for no rounds', () => {
    expect(computeEndlessStats([])).toEqual({
      roundsPlayed: 0,
      totalScore: 0,
      avgScorePerRound: 0,
      avgDistanceKm: 0,
      bestFiveRoundSegment: null,
    });
  });

  it('computes totals and averages', () => {
    const stats = computeEndlessStats([result(1000, 100), result(2000, 200), result(3000, 300)]);
    expect(stats.roundsPlayed).toBe(3);
    expect(stats.totalScore).toBe(6000);
    expect(stats.avgScorePerRound).toBe(2000);
    expect(stats.avgDistanceKm).toBeCloseTo(200);
    expect(stats.bestFiveRoundSegment).toBeNull();
  });

  it('finds the best 5-round segment once at least 5 rounds are played', () => {
    // Scores: 100,100,100,100,100 (=500), then 5000,100,100,100,100 (=5400 best window)
    const scores = [100, 100, 100, 100, 100, 5000, 100, 100, 100, 100];
    const stats = computeEndlessStats(scores.map((s) => result(s)));
    expect(stats.bestFiveRoundSegment).toBe(5400);
  });
});

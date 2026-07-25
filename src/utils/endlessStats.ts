import type { RoundResult } from '../types';

export interface EndlessStats {
  roundsPlayed: number;
  totalScore: number;
  avgScorePerRound: number;
  avgDistanceKm: number;
  /** Highest-scoring run of 5 consecutive rounds, or null if fewer than 5 played. */
  bestFiveRoundSegment: number | null;
}

/** Pure summary stats for an Endless session, shown when the player finishes. */
export function computeEndlessStats(results: readonly RoundResult[]): EndlessStats {
  const roundsPlayed = results.length;
  if (roundsPlayed === 0) {
    return { roundsPlayed: 0, totalScore: 0, avgScorePerRound: 0, avgDistanceKm: 0, bestFiveRoundSegment: null };
  }

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const totalDistance = results.reduce((sum, r) => sum + r.distanceKm, 0);

  let bestFiveRoundSegment: number | null = null;
  if (roundsPlayed >= 5) {
    let windowSum = results.slice(0, 5).reduce((sum, r) => sum + r.score, 0);
    bestFiveRoundSegment = windowSum;
    for (let i = 5; i < roundsPlayed; i++) {
      windowSum += results[i].score - results[i - 5].score;
      bestFiveRoundSegment = Math.max(bestFiveRoundSegment, windowSum);
    }
  }

  return {
    roundsPlayed,
    totalScore,
    avgScorePerRound: totalScore / roundsPlayed,
    avgDistanceKm: totalDistance / roundsPlayed,
    bestFiveRoundSegment,
  };
}

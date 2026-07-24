import { describe, it, expect } from 'vitest';
import { calculateScore } from '../utils/score';
import { haversineDistanceKm } from '../utils/distance';
import { SCORE_VECTORS, DISTANCE_VECTORS } from './__fixtures__/scoreVectors';

/**
 * Multiplayer scores are computed on the trusted database side (mp_score /
 * mp_haversine_km). These vectors are also asserted against those SQL functions
 * in supabase/tests, so passing here + there proves TS↔SQL parity.
 */
describe('scoring parity (solo TS ↔ multiplayer SQL)', () => {
  it('matches the shared distance→score vectors exactly', () => {
    for (const { distanceKm, score } of SCORE_VECTORS) {
      expect(calculateScore(distanceKm)).toBe(score);
    }
  });

  it('matches Haversine distance + score for coordinate pairs', () => {
    for (const { a, b, km, score } of DISTANCE_VECTORS) {
      const d = haversineDistanceKm(a, b);
      expect(Number(d.toFixed(4))).toBe(km);
      expect(calculateScore(d)).toBe(score);
    }
  });

  it('reuses the solo formula (no separate multiplayer scoring)', () => {
    // A perfect guess is the max; a miss decays but never goes negative.
    expect(calculateScore(0)).toBe(5000);
    expect(calculateScore(1e9)).toBe(0);
  });
});

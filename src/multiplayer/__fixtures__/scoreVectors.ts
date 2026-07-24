/**
 * Shared scoring test vectors — the single source of truth proving the
 * multiplayer SQL scoring matches the solo TypeScript scoring exactly.
 *
 * The same integer results are asserted in the SQL verification script
 * (supabase/tests/01_multiplayer_verify.sql) against `mp_score` /
 * `mp_haversine_km`, so TypeScript and Postgres are proven equivalent.
 */

/** distanceKm → expected whole-number score (maxRoundScore 5000, falloff 2000 km). */
export const SCORE_VECTORS: ReadonlyArray<{ distanceKm: number; score: number }> = [
  { distanceKm: 0, score: 5000 },
  { distanceKm: 1, score: 4998 },
  { distanceKm: 100, score: 4756 },
  { distanceKm: 500, score: 3894 },
  { distanceKm: 1000, score: 3033 },
  { distanceKm: 2000, score: 1839 },
  { distanceKm: 5000, score: 410 },
  { distanceKm: 20000, score: 0 },
];

/** Coordinate pairs → expected Haversine km (4 dp) and resulting score. */
export const DISTANCE_VECTORS: ReadonlyArray<{
  a: { lat: number; lng: number };
  b: { lat: number; lng: number };
  km: number;
  score: number;
}> = [
  {
    // Paris (Champ de Mars) → London (Westminster)
    a: { lat: 48.8584, lng: 2.2945 },
    b: { lat: 51.5007, lng: -0.1246 },
    km: 340.5389,
    score: 4217,
  },
  {
    // A guess near Paris used in the SQL submit-guess test.
    a: { lat: 48.0, lng: 2.0 },
    b: { lat: 48.8584, lng: 2.2945 },
    km: 97.8916,
    score: 4761,
  },
];

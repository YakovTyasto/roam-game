import { APP } from '../config/app';

export interface ScoreOptions {
  maxScore?: number;
  /** Falloff constant in kilometres. Larger = more forgiving. */
  falloffKm?: number;
}

/**
 * Exponential distance scoring.
 *
 *   score = maxScore * exp(-distanceKm / falloffKm)
 *
 * A perfect guess (0 km) yields the maximum. Points decay smoothly with
 * distance and approach — but never dip below — zero. The result is clamped
 * to the range [0, maxScore] and rounded to a whole number.
 */
export function calculateScore(
  distanceKm: number,
  options: ScoreOptions = {},
): number {
  const maxScore = options.maxScore ?? APP.maxRoundScore;
  const falloffKm = options.falloffKm ?? APP.scoreFalloffKm;

  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;

  const raw = maxScore * Math.exp(-distanceKm / falloffKm);
  const rounded = Math.round(raw);

  return Math.max(0, Math.min(maxScore, rounded));
}

/** A short, human performance message for a final game score. */
export function performanceMessage(totalScore: number, maxTotal: number): string {
  const ratio = maxTotal > 0 ? totalScore / maxTotal : 0;
  if (ratio >= 0.95) return 'Cartographer';
  if (ratio >= 0.8) return 'Seasoned explorer';
  if (ratio >= 0.6) return 'Confident traveller';
  if (ratio >= 0.4) return 'Getting your bearings';
  if (ratio >= 0.2) return 'Lost but curious';
  return 'Off the map';
}

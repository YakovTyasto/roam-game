import type { GameLocation } from '../types';
import { selectUniqueLocationsAvoidingHistory } from '../utils/selectRounds';
import { readLocationHistory, recordPlayedLocations } from '../utils/locationHistory';
import type { ManifestRound } from './types';
import { resolvePanoId } from './resolvePanorama';

/**
 * Validate a match manifest on the client BEFORE sending it to the start-match
 * RPC. The SQL function performs the same checks server-side (it is the real
 * authority); this gives fast, friendly feedback and documents the contract.
 *
 * Checks: exact round count, coordinate ranges, required non-empty fields,
 * heading range, and no duplicate locations.
 */
export function validateManifest(
  rounds: ManifestRound[],
  expectedCount: number,
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(rounds)) {
    return { ok: false, error: 'Manifest must be an array.' };
  }
  if (rounds.length !== expectedCount) {
    return {
      ok: false,
      error: `Manifest must contain exactly ${expectedCount} rounds.`,
    };
  }

  const seen = new Set<string>();
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const where = `round ${i + 1}`;
    if (!r || typeof r !== 'object') {
      return { ok: false, error: `${where} is malformed.` };
    }
    if (!isFiniteNumber(r.lat) || r.lat < -90 || r.lat > 90) {
      return { ok: false, error: `${where} has an invalid latitude.` };
    }
    if (!isFiniteNumber(r.lng) || r.lng < -180 || r.lng > 180) {
      return { ok: false, error: `${where} has an invalid longitude.` };
    }
    if (!isNonEmptyString(r.location_id)) {
      return { ok: false, error: `${where} is missing a location id.` };
    }
    if (!isNonEmptyString(r.pano_id)) {
      return { ok: false, error: `${where} is missing panorama data.` };
    }
    if (!isNonEmptyString(r.label) || !isNonEmptyString(r.country)) {
      return { ok: false, error: `${where} is missing its label/country.` };
    }
    if (!isFiniteNumber(r.heading) || r.heading < 0 || r.heading > 360) {
      return { ok: false, error: `${where} has an invalid heading.` };
    }
    if (seen.has(r.location_id)) {
      return { ok: false, error: 'Manifest contains a duplicate location.' };
    }
    seen.add(r.location_id);
  }

  return { ok: true };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Host-only: build a validated round manifest using the existing curated
 * location pool and the Google Street View service. Orders the pool (preferring
 * locations outside the persistent recent-location history — see
 * `utils/locationHistory.ts`), resolves a concrete panorama for each candidate,
 * and stops once `count` playable rounds are found. Each round gets a fixed
 * random heading so both clients open facing the same direction.
 *
 * On success, records the chosen locations in the shared history so this same
 * shared implementation also drives solo's server-tracked path (see
 * `solo/useSoloRun.ts`) and multiplayer's host-only match start (see
 * `multiplayer/useMultiplayer.ts`) away from repeats in future matches.
 *
 * Throws if not enough panoramas can be resolved from the pool; history is not
 * updated on failure.
 */
export async function buildManifest(
  google: typeof window.google,
  pool: GameLocation[],
  count: number,
  options: { rng?: () => number } = {},
): Promise<ManifestRound[]> {
  const rng = options.rng ?? Math.random;
  const recentIds = readLocationHistory();
  const candidates = selectUniqueLocationsAvoidingHistory(pool, pool.length, recentIds, rng);

  const rounds: ManifestRound[] = [];
  for (const loc of candidates) {
    if (rounds.length >= count) break;
    const panoId = await resolvePanoId(google, loc);
    if (!panoId) continue;
    rounds.push({
      location_id: loc.id,
      lat: loc.lat,
      lng: loc.lng,
      label: loc.label,
      country: loc.country,
      pano_id: panoId,
      heading: Math.floor(rng() * 360),
      pitch: 0,
      zoom: 0,
    });
  }

  if (rounds.length < count) {
    throw new Error(
      'Could not find enough Street View panoramas to start the match. Please try again.',
    );
  }

  const check = validateManifest(rounds, count);
  if (!check.ok) {
    throw new Error(check.error);
  }

  recordPlayedLocations(rounds.map((r) => r.location_id));
  return rounds;
}

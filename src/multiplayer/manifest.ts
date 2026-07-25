import type { GameLocation } from '../types';
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
 * Host-only: build a validated round manifest from an **already-ordered**
 * candidate list, resolving a concrete panorama for each candidate and stopping
 * once `count` playable rounds are found. Each round gets a fixed random
 * heading so every client opens facing the same direction.
 *
 * Ordering is the Diversity Engine's job, not this function's: callers pass
 * `candidates` straight from `diversity/engine.ts#selectRounds`, which has
 * already applied the collection filter, the difficulty pool, canonical
 * grouping, shuffle-bag cycling and the room's combined novelty ranking. Any
 * candidate whose panorama cannot be resolved is skipped and the next one is
 * tried, so the list should be longer than `count`.
 *
 * Records nothing. History and bag state advance only when a round actually
 * starts (`diversity/store.ts#commitRoundStarted`) — building a manifest that
 * is then rejected by the start RPC must not cost the player any freshness.
 *
 * Throws if not enough panoramas can be resolved from the candidates.
 */
export async function buildManifest(
  google: typeof window.google,
  candidates: readonly GameLocation[],
  count: number,
  options: { rng?: () => number } = {},
): Promise<ManifestRound[]> {
  const rng = options.rng ?? Math.random;

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

  return rounds;
}

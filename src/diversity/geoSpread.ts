/**
 * Soft in-match geographic spread.
 *
 * Uniqueness and the requested difficulty are hard guarantees. Geographic
 * variety is not: a five-round game *should* feel like it circled the world,
 * but a themed collection ("Islands", "Europe") makes continental spread
 * impossible by definition, and a small pool can make it impossible by
 * accident. So this layer only ever **reorders** candidates the engine has
 * already approved — it never adds, drops, or substitutes one.
 *
 * The rules, strongest first:
 *   1. No two consecutive rounds in the same country.
 *   2. No two rounds in the same small geographic cluster (one metro area).
 *   3. No continent over-represented beyond `maxPerContinent`.
 *
 * They are applied through **progressive relaxation**: for each slot, walk the
 * ranked candidates and take the first that satisfies every active rule; if
 * none does, drop the weakest rule and try again. The last relaxation level
 * accepts anything, so a slot is always filled — the algorithm performs
 * exactly `count` picks and cannot loop.
 *
 * Because the walk always follows the novelty ranking, the *freshest* candidate
 * that satisfies the constraints wins. Spread never overrides freshness; it
 * only breaks ties among candidates the bag was equally happy with.
 */

import type { GameLocation } from '../types';
import type { Continent } from '../config/geography';
import { continentForCountry } from '../config/geography';
import { CANONICAL_THRESHOLDS, type CanonicalThresholds } from '../utils/canonicalGroup';
import { haversineDistanceKm } from '../utils/distance';

/**
 * How many rounds of one continent are acceptable. A five-round game allows
 * two, so it must touch at least three continents when the pool permits; a
 * three-round game also allows two, because demanding three distinct
 * continents from three rounds would relax away almost immediately on any
 * regional pool and just add noise.
 */
export function maxPerContinent(count: number): number {
  return Math.max(2, Math.ceil(count / 3));
}

/** Relaxation levels, strongest constraints first. */
const enum Level {
  /** Country, cluster and continent rules all enforced. */
  Full = 0,
  /** Continent cap dropped. */
  NoContinentCap = 1,
  /** Cluster rule also dropped. */
  NoCluster = 2,
  /** Nothing enforced — guarantees a pick, and therefore termination. */
  None = 3,
}

function continentOf(location: GameLocation): Continent | null {
  return location.continent ?? continentForCountry(location.country);
}

interface SpreadState {
  picked: GameLocation[];
  continentCounts: Map<string, number>;
}

function satisfies(
  candidate: GameLocation,
  state: SpreadState,
  level: Level,
  limit: number,
  thresholds: CanonicalThresholds,
): boolean {
  if (level >= Level.None) return true;

  const previous = state.picked[state.picked.length - 1];
  if (previous && previous.country === candidate.country) return false;

  if (level < Level.NoCluster) {
    for (const already of state.picked) {
      if (haversineDistanceKm(already, candidate) <= thresholds.clusterKm) return false;
    }
  }

  if (level < Level.NoContinentCap) {
    const continent = continentOf(candidate);
    if (continent && (state.continentCounts.get(continent) ?? 0) >= limit) return false;
  }

  return true;
}

/**
 * Reorder `ranked` so its first `count` entries are as geographically varied as
 * the pool allows, preserving the novelty ranking wherever the rules are
 * indifferent. Returns a permutation of the input — same length, same members.
 *
 * `alreadyPicked` are rounds chosen before this call, from a different
 * candidate segment (the shuffle bag arranges either side of a cycle boundary
 * separately). They constrain the rules but are never returned, so a match that
 * spans a cycle boundary is still spread as one game.
 */
export function spreadGeography(
  ranked: readonly GameLocation[],
  count: number,
  alreadyPicked: readonly GameLocation[] = [],
  thresholds: CanonicalThresholds = CANONICAL_THRESHOLDS,
): GameLocation[] {
  const wanted = Math.min(Math.max(0, Math.floor(count)), ranked.length);
  if (wanted < 1) return [...ranked];
  if (wanted === 1 && alreadyPicked.length === 0) return [...ranked];

  // The continent cap is a property of the whole match, so it counts the
  // rounds already chosen as well as the ones this call will choose.
  const limit = maxPerContinent(wanted + alreadyPicked.length);
  const remaining = [...ranked];
  const state: SpreadState = { picked: [...alreadyPicked], continentCounts: new Map() };
  for (const location of alreadyPicked) {
    const continent = continentOf(location);
    if (continent) {
      state.continentCounts.set(continent, (state.continentCounts.get(continent) ?? 0) + 1);
    }
  }
  const carried = alreadyPicked.length;

  for (let slot = 0; slot < wanted; slot++) {
    let chosenIndex = -1;
    for (let level = Level.Full; level <= Level.None && chosenIndex === -1; level++) {
      chosenIndex = remaining.findIndex((candidate) =>
        satisfies(candidate, state, level, limit, thresholds),
      );
    }
    // Level.None accepts anything, so `remaining` being non-empty guarantees a
    // hit. The guard is belt-and-braces against a future rule change.
    if (chosenIndex === -1) break;

    const [chosen] = remaining.splice(chosenIndex, 1);
    state.picked.push(chosen);
    const continent = continentOf(chosen);
    if (continent) {
      state.continentCounts.set(continent, (state.continentCounts.get(continent) ?? 0) + 1);
    }
  }

  // Drop the carried-in prefix: it belongs to the caller's earlier segment and
  // must not be returned here, or it would appear twice in the match.
  // Everything not selected keeps its ranked order and becomes backup material.
  return [...state.picked.slice(carried), ...remaining];
}

/** Diagnostics for a chosen set — used by tests and the audit summary. */
export interface SpreadReport {
  countries: number;
  continents: number;
  consecutiveSameCountry: number;
  sameClusterPairs: number;
  maxPerContinent: number;
}

export function describeSpread(
  locations: readonly GameLocation[],
  thresholds: CanonicalThresholds = CANONICAL_THRESHOLDS,
): SpreadReport {
  const countries = new Set(locations.map((l) => l.country));
  const continentCounts = new Map<string, number>();
  for (const l of locations) {
    const c = continentOf(l);
    if (c) continentCounts.set(c, (continentCounts.get(c) ?? 0) + 1);
  }

  let consecutiveSameCountry = 0;
  for (let i = 1; i < locations.length; i++) {
    if (locations[i].country === locations[i - 1].country) consecutiveSameCountry += 1;
  }

  let sameClusterPairs = 0;
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      if (haversineDistanceKm(locations[i], locations[j]) <= thresholds.clusterKm) {
        sameClusterPairs += 1;
      }
    }
  }

  return {
    countries: countries.size,
    continents: continentCounts.size,
    consecutiveSameCountry,
    sameClusterPairs,
    maxPerContinent: Math.max(0, ...continentCounts.values()),
  };
}

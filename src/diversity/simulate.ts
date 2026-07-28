/**
 * Deterministic simulation harness for the Diversity Engine.
 *
 * The engine's promises are statistical ("every place before any repeat",
 * "distribution isn't biased toward a handful of favourites"), and a handful of
 * hand-written cases cannot check those. This plays whole sequences of games
 * against a seeded RNG and reports what actually happened, so the properties
 * are asserted over hundreds of games while staying fast and reproducible.
 *
 * Pure: no storage, no clock, no network. Bag state is threaded explicitly, the
 * way `store.ts` threads it through localStorage in the real app.
 */

import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import type { CollectionId } from '../config/collections';
import { locationsInCollection } from '../config/collections';
import { selectRounds } from './engine';
import { EMPTY_BAG, type BagState } from './shuffleBag';
import { describeSpread } from './geoSpread';
import { seededRng } from './__fixtures__/rng';
import { HISTORY_LIMIT_GROUPS } from '../config/diversity';

export interface SimulationOptions {
  all: readonly GameLocation[];
  /** How many consecutive games one player plays. */
  games: number;
  roundCount: number;
  difficulty?: Difficulty;
  collection?: CollectionId;
  seed?: number;
  /** Starting history, newest-first. */
  recentGroupIds?: readonly string[];
  /** Apply the soft geographic spread rules (default true, as in real play). */
  spread?: boolean;
}

export interface SimulationResult {
  /** Canonical group ids drawn, per game, in play order. */
  games: string[][];
  /** Locations drawn, per game — for geographic analysis. */
  gameLocations: GameLocation[][];
  /** How many times each group was served across the whole run. */
  counts: Map<string, number>;
  /** Distinct places the pool offered. */
  poolGroups: number;
  /** Games that contained the same place twice. Must always be 0. */
  gamesWithDuplicates: number;
  /**
   * Rounds served before any place repeated. With a large enough pool this
   * equals the pool size — the shuffle bag's central guarantee.
   */
  roundsBeforeFirstRepeat: number;
  /** Bag cycles completed over the run. */
  cyclesCompleted: number;
  /** Games where the requested difficulty was not honoured. Must be 0 when the pool suffices. */
  gamesOffDifficulty: number;
  /** Games where a place fell outside the requested collection. Must always be 0. */
  gamesOffCollection: number;
  /** Total rounds served. */
  totalRounds: number;
}

/** Play `games` consecutive games as one player, threading bag and history. */
export function simulateGames(options: SimulationOptions): SimulationResult {
  const {
    all,
    games,
    roundCount,
    difficulty = 'normal',
    collection = 'world',
    seed = 1,
    recentGroupIds = [],
    spread = true,
  } = options;

  const rng = seededRng(seed);
  let bag: BagState = EMPTY_BAG;
  let history: string[] = [...recentGroupIds];

  const played: string[][] = [];
  const playedLocations: GameLocation[][] = [];
  const counts = new Map<string, number>();
  const seen = new Set<string>();

  let gamesWithDuplicates = 0;
  let roundsBeforeFirstRepeat = 0;
  let firstRepeatFound = false;
  let totalRounds = 0;
  let poolGroups = 0;
  let gamesOffDifficulty = 0;
  let gamesOffCollection = 0;
  // The collection is a hard filter in the engine, so this counter should stay
  // at zero — it is checked rather than assumed, because "hard filter" is a
  // property of the code, not of the type system.
  const inCollection = new Set(locationsInCollection(all, collection).map((l) => l.id));

  for (let game = 0; game < games; game++) {
    const result = selectRounds({
      all,
      count: roundCount,
      difficulty,
      collection,
      bag,
      recentGroupIds: history,
      rng,
      spread,
    });

    bag = result.nextBag;
    poolGroups = result.poolGroups;

    if (new Set(result.groupIds).size !== result.groupIds.length) gamesWithDuplicates += 1;
    if (result.locations.some((l) => !inCollection.has(l.id))) gamesOffCollection += 1;
    if (!result.usedDifficultyFallback && result.locations.some((l) => l.difficulty !== difficulty)) {
      gamesOffDifficulty += 1;
    }

    for (const groupId of result.groupIds) {
      totalRounds += 1;
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
      if (!firstRepeatFound) {
        if (seen.has(groupId)) firstRepeatFound = true;
        else roundsBeforeFirstRepeat += 1;
      }
      seen.add(groupId);
    }

    // Mirror the real commit path: history is newest-first and bounded.
    history = [...result.groupIds.slice().reverse(), ...history]
      .filter((id, index, arr) => arr.indexOf(id) === index)
      .slice(0, HISTORY_LIMIT_GROUPS);

    played.push(result.groupIds);
    playedLocations.push(result.locations);
  }

  return {
    games: played,
    gameLocations: playedLocations,
    counts,
    poolGroups,
    gamesWithDuplicates,
    roundsBeforeFirstRepeat,
    cyclesCompleted: bag.cycle,
    gamesOffDifficulty,
    gamesOffCollection,
    totalRounds,
  };
}

export interface DistributionStats {
  /** Distinct places that were served at least once. */
  distinctServed: number;
  min: number;
  max: number;
  mean: number;
  /**
   * Standard deviation over the mean. A perfectly even deal is 0; a run that
   * favours a small subset climbs quickly. Robust to run length in a way a raw
   * standard deviation is not.
   */
  coefficientOfVariation: number;
  /** Share of all rounds taken by the ten most-served places. */
  topTenShare: number;
}

/** Summarise how evenly a run spread itself over the pool. */
export function distributionStats(result: SimulationResult): DistributionStats {
  // Places never served count as zero, or a run that ignores half the pool
  // would look perfectly even.
  const counts: number[] = [];
  for (const count of result.counts.values()) counts.push(count);
  while (counts.length < result.poolGroups) counts.push(0);

  const n = Math.max(1, counts.length);
  const mean = counts.reduce((a, b) => a + b, 0) / n;
  const variance = counts.reduce((acc, c) => acc + (c - mean) ** 2, 0) / n;
  const sorted = [...counts].sort((a, b) => b - a);
  const topTen = sorted.slice(0, 10).reduce((a, b) => a + b, 0);

  return {
    distinctServed: result.counts.size,
    min: Math.min(...counts),
    max: Math.max(...counts),
    mean,
    coefficientOfVariation: mean > 0 ? Math.sqrt(variance) / mean : 0,
    topTenShare: result.totalRounds > 0 ? topTen / result.totalRounds : 0,
  };
}

export interface SpreadStats {
  /** Mean distinct countries per game. */
  countriesPerGame: number;
  /** Mean distinct continents per game. */
  continentsPerGame: number;
  /** Games containing two consecutive rounds in one country. */
  gamesWithConsecutiveCountry: number;
  /** Games containing two rounds in one metro cluster. */
  gamesWithClusterPair: number;
}

/** Summarise the geographic character of the simulated games. */
export function spreadStats(result: SimulationResult): SpreadStats {
  let countries = 0;
  let continents = 0;
  let consecutive = 0;
  let clustered = 0;

  for (const locations of result.gameLocations) {
    const report = describeSpread(locations);
    countries += report.countries;
    continents += report.continents;
    if (report.consecutiveSameCountry > 0) consecutive += 1;
    if (report.sameClusterPairs > 0) clustered += 1;
  }

  const n = Math.max(1, result.gameLocations.length);
  return {
    countriesPerGame: countries / n,
    continentsPerGame: continents / n,
    gamesWithConsecutiveCountry: consecutive,
    gamesWithClusterPair: clustered,
  };
}

/** One-line human summary, printed by the simulation audit test. */
export function summarise(label: string, result: SimulationResult): string {
  const dist = distributionStats(result);
  const spread = spreadStats(result);
  return [
    `${label}:`,
    `${result.games.length} games × ${result.games[0]?.length ?? 0} rounds`,
    `| pool ${result.poolGroups} places`,
    `| fresh rounds before first repeat ${result.roundsBeforeFirstRepeat}`,
    `| cycles ${result.cyclesCompleted}`,
    `| served ${dist.distinctServed}/${result.poolGroups}`,
    `| per-place min ${dist.min} max ${dist.max} CoV ${dist.coefficientOfVariation.toFixed(3)}`,
    `| countries/game ${spread.countriesPerGame.toFixed(2)}`,
    `| continents/game ${spread.continentsPerGame.toFixed(2)}`,
    `| dup matches ${result.gamesWithDuplicates}`,
  ].join(' ');
}

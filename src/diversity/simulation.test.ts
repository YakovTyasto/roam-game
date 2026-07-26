import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import type { Continent } from '../config/geography';
import { LOCATIONS } from '../data/locations';
import { GAME_ROUND_COUNTS } from '../config/diversity';
import { distributionStats, simulateGames, spreadStats, summarise } from './simulate';
import { selectRounds } from './engine';
import { seededRng } from './__fixtures__/rng';
import { buildRoomRecentKeys, parseRoomRecentGroups } from '../multiplayer/roomDiversity';

/**
 * Statistical verification of the Diversity Engine.
 *
 * Every claim here is asserted over hundreds of simulated games against seeded
 * RNGs, so the results are reproducible on every machine and every run — the
 * tests are deterministic even though the properties are statistical.
 */

const CONTINENTS: readonly Continent[] = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
];

/**
 * A synthetic catalog large enough to exercise the statistical properties.
 *
 * Coordinates are laid out on a coarse grid — 8° of latitude and 17° of
 * longitude apart, with each difficulty tier on its own 2° band. That spacing
 * is far beyond the 25 km cluster threshold, so every entry is its own
 * canonical group and every tier is geographically disjoint. (An earlier
 * version of this fixture used modular arithmetic that quietly produced
 * colliding coordinates; the engine correctly merged those rows into shared
 * groups, which made "60 places" mean 52 and broke the coverage assertions.)
 */
function syntheticCatalog(
  size: number,
  difficulty: GameLocation['difficulty'] = 'normal',
): GameLocation[] {
  const band = { easy: 0, normal: 1, hard: 2 }[difficulty];
  const perRow = 20;
  return Array.from({ length: size }, (_, i) => ({
    id: `s-${difficulty}-${i}`,
    lat: -80 + Math.floor(i / perRow) * 8 + band * 2,
    lng: -170 + (i % perRow) * 17,
    label: `Place ${i}`,
    // A distinct country per place, so the country rule is always satisfiable
    // and any violation is an algorithm bug rather than a forced relaxation.
    country: `Country ${difficulty}-${i}`,
    continent: CONTINENTS[i % CONTINENTS.length],
    difficulty,
  }));
}

describe('uniqueness at scale', () => {
  it('never repeats a place inside one match, across every offered length', () => {
    for (const roundCount of GAME_ROUND_COUNTS) {
      const result = simulateGames({
        all: syntheticCatalog(200),
        games: 100,
        roundCount,
        seed: roundCount,
      });
      expect(result.gamesWithDuplicates, `${roundCount}-round games`).toBe(0);
      expect(result.totalRounds).toBe(100 * roundCount);
    }
  });

  it('never repeats within a match even when the pool barely fits', () => {
    // Pool of 21 for 20-round games: every game consumes nearly everything.
    const result = simulateGames({
      all: syntheticCatalog(21),
      games: 50,
      roundCount: 20,
      seed: 5,
    });
    expect(result.gamesWithDuplicates).toBe(0);
  });
});

describe('shuffle-bag coverage', () => {
  it('serves every place before repeating any', () => {
    const size = 60;
    const result = simulateGames({
      all: syntheticCatalog(size),
      games: 24,
      roundCount: 5,
      seed: 11,
    });
    // The bag's central guarantee: a full pool's worth of distinct places is
    // dealt before anything comes round again.
    expect(result.roundsBeforeFirstRepeat).toBe(size);
    expect(result.counts.size).toBe(size);
  });

  it('holds for every offered round count', () => {
    for (const roundCount of GAME_ROUND_COUNTS) {
      const size = roundCount * 6;
      const result = simulateGames({
        all: syntheticCatalog(size),
        games: 12,
        roundCount,
        seed: 100 + roundCount,
      });
      expect(result.roundsBeforeFirstRepeat, `${roundCount}-round games`).toBe(size);
    }
  });

  it('completes multiple cycles over a long run', () => {
    const result = simulateGames({
      all: syntheticCatalog(50),
      games: 100,
      roundCount: 5,
      seed: 3,
    });
    expect(result.cyclesCompleted).toBeGreaterThanOrEqual(9);
  });

  it('does not deal the same cycle order twice', () => {
    const size = 20;
    const result = simulateGames({
      all: syntheticCatalog(size),
      games: 8,
      roundCount: 5,
      seed: 7,
    });
    const cycleOne = result.games.slice(0, 4).flat();
    const cycleTwo = result.games.slice(4, 8).flat();
    expect(new Set(cycleOne).size).toBe(size);
    expect(new Set(cycleTwo).size).toBe(size);
    expect(cycleTwo).not.toEqual(cycleOne);
  });
});

describe('distribution fairness', () => {
  it('spreads rounds evenly rather than favouring a small subset', () => {
    const size = 60;
    const result = simulateGames({
      all: syntheticCatalog(size),
      games: 240, // exactly 20 full cycles at 5 rounds
      roundCount: 5,
      seed: 21,
    });
    const stats = distributionStats(result);

    expect(stats.distinctServed).toBe(size);
    // Full cycles mean every place is served the same number of times. That is
    // the bag working — not luck.
    expect(stats.min).toBe(stats.max);
    expect(stats.coefficientOfVariation).toBe(0);
    // Ten of sixty places must take about a sixth of the rounds, not more.
    expect(stats.topTenShare).toBeLessThan(0.2);
  });

  it('stays near-even at an arbitrary cut-off mid-cycle', () => {
    const result = simulateGames({
      all: syntheticCatalog(37),
      games: 101,
      roundCount: 5,
      seed: 22,
    });
    const stats = distributionStats(result);
    // Mid-cycle, counts can differ by at most one deal.
    expect(stats.max - stats.min).toBeLessThanOrEqual(1);
    expect(stats.coefficientOfVariation).toBeLessThan(0.1);
  });

  it('is not biased by the order or the ids of the catalog', () => {
    const size = 40;
    const catalog = syntheticCatalog(size);
    const result = simulateGames({ all: catalog, games: 40, roundCount: 5, seed: 31 });

    // Every place appears in the first slot of some game roughly as often as
    // any other — a selector that leaked catalog order would not manage this.
    const firstSlot = new Map<string, number>();
    for (const game of result.games) {
      firstSlot.set(game[0], (firstSlot.get(game[0]) ?? 0) + 1);
    }
    expect(firstSlot.size).toBeGreaterThan(size / 3);
    expect(Math.max(...firstSlot.values())).toBeLessThanOrEqual(4);
  });

  it('varies between seeds', () => {
    const catalog = syntheticCatalog(40);
    const a = simulateGames({ all: catalog, games: 5, roundCount: 5, seed: 1 });
    const b = simulateGames({ all: catalog, games: 5, roundCount: 5, seed: 2 });
    expect(a.games).not.toEqual(b.games);
  });

  it('is reproducible for a seed', () => {
    const catalog = syntheticCatalog(40);
    const a = simulateGames({ all: catalog, games: 20, roundCount: 5, seed: 99 });
    const b = simulateGames({ all: catalog, games: 20, roundCount: 5, seed: 99 });
    expect(a.games).toEqual(b.games);
  });
});

describe('difficulty preservation', () => {
  const mixed = [
    ...syntheticCatalog(40, 'easy'),
    ...syntheticCatalog(40, 'normal'),
    ...syntheticCatalog(40, 'hard'),
  ];

  it('never leaves the requested tier when it can fill the game', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const result = simulateGames({
        all: mixed,
        games: 100,
        roundCount: 5,
        difficulty,
        seed: 41,
      });
      expect(result.gamesOffDifficulty, difficulty).toBe(0);
    }
  });

  it('keeps tiers independent — exhausting one does not consume another', () => {
    const easy = simulateGames({ all: mixed, games: 8, roundCount: 5, difficulty: 'easy', seed: 1 });
    const hard = simulateGames({ all: mixed, games: 8, roundCount: 5, difficulty: 'hard', seed: 1 });
    const easyIds = new Set(easy.games.flat());
    expect(hard.games.flat().some((id) => easyIds.has(id))).toBe(false);
  });

  it('widens to adjacent tiers only when the tier cannot fill the game', () => {
    const lopsided = [...syntheticCatalog(3, 'easy'), ...syntheticCatalog(60, 'normal')];
    const result = selectRounds({ all: lopsided, count: 10, difficulty: 'easy', rng: seededRng(1) });
    expect(result.usedDifficultyFallback).toBe(true);
    expect(result.locations).toHaveLength(10);
  });
});

describe('history avoidance and least-recent fallback', () => {
  it('avoids a seeded recent history on a fresh bag', () => {
    const catalog = syntheticCatalog(40);
    const recent = catalog.slice(0, 20).map((l) => l.id);
    const result = simulateGames({
      all: catalog,
      games: 4,
      roundCount: 5,
      seed: 51,
      recentGroupIds: recent,
    });
    // Twenty places are burned and twenty are fresh: four games of five must
    // consume exactly the fresh ones.
    const drawn = result.games.flat();
    expect(drawn.filter((id) => recent.includes(id))).toHaveLength(0);
  });

  it('falls back to least-recently-played when history covers everything', () => {
    const catalog = syntheticCatalog(20);
    // History newest-first: the last entries are the oldest plays.
    const recent = catalog.map((l) => l.id);
    const result = selectRounds({
      all: catalog,
      count: 5,
      recentGroupIds: recent,
      rng: seededRng(61),
      spread: false,
    });
    expect(result.locations).toHaveLength(5);
    // Every pick comes from the older half of the history.
    const positions = result.groupIds.map((id) => recent.indexOf(id));
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(recent.length / 2 - 1);
  });

  it('treats malformed history as no history and still deals a full game', () => {
    const catalog = syntheticCatalog(30);
    const junk = ['', 'unknown-place', 'null', '{}', catalog[0].id];
    for (let seed = 1; seed <= 25; seed++) {
      const result = selectRounds({
        all: catalog,
        count: 5,
        recentGroupIds: junk,
        rng: seededRng(seed),
      });
      expect(result.locations).toHaveLength(5);
      expect(new Set(result.groupIds).size).toBe(5);
    }
  });
});

describe('multiplayer combined history', () => {
  const catalog = syntheticCatalog(40);
  const iso = (minutes: number) =>
    new Date(Date.UTC(2026, 0, 1) - minutes * 60_000).toISOString();

  it('avoids what the room has collectively played', () => {
    const roomSeen = catalog.slice(0, 20).map((l) => l.id);
    const aggregate = parseRoomRecentGroups({
      applied: true,
      reason: 'ok',
      participants_considered: 3,
      groups: roomSeen.map((id, i) => ({ group_id: id, seen_by: 3, last_played_at: iso(i) })),
    });
    const recent = buildRoomRecentKeys(aggregate, []);

    for (let seed = 1; seed <= 40; seed++) {
      const result = selectRounds({ all: catalog, count: 5, recentGroupIds: recent, rng: seededRng(seed) });
      expect(result.groupIds.filter((id) => roomSeen.includes(id))).toHaveLength(0);
    }
  });

  it('prefers places fewer of the room have seen', () => {
    const aggregate = parseRoomRecentGroups({
      applied: true,
      reason: 'ok',
      participants_considered: 5,
      groups: catalog.map((l, i) => ({
        group_id: l.id,
        // The first ten are burned for the whole room; the rest for one player.
        seen_by: i < 10 ? 5 : 1,
        last_played_at: iso(i),
      })),
    });
    const recent = buildRoomRecentKeys(aggregate, []);
    const heavilySeen = new Set(catalog.slice(0, 10).map((l) => l.id));

    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const result = selectRounds({ all: catalog, count: 5, recentGroupIds: recent, rng: seededRng(seed) });
      hits += result.groupIds.filter((id) => heavilySeen.has(id)).length;
    }
    // 10 of 40 places are room-wide burned; a fair draw would hit them ~50
    // times in 200 rounds. Ranking must push that far down.
    expect(hits).toBeLessThan(10);
  });

  it('still deals a full match when the room has seen nearly everything', () => {
    const aggregate = parseRoomRecentGroups({
      applied: true,
      reason: 'ok',
      participants_considered: 7,
      groups: catalog.slice(0, 39).map((l, i) => ({
        group_id: l.id,
        seen_by: 7,
        last_played_at: iso(i),
      })),
    });
    const recent = buildRoomRecentKeys(aggregate, []);
    for (let seed = 1; seed <= 25; seed++) {
      const result = selectRounds({ all: catalog, count: 5, recentGroupIds: recent, rng: seededRng(seed) });
      expect(result.locations).toHaveLength(5);
      expect(new Set(result.groupIds).size).toBe(5);
    }
  });
});

describe('soft geographic diversity at scale', () => {
  it('holds the country and cluster rules perfectly when the pool allows', () => {
    // A synthetic pool with a distinct country per place: the rules are always
    // satisfiable, so any violation would be an algorithm bug rather than a
    // forced relaxation.
    const result = simulateGames({ all: syntheticCatalog(200), games: 300, roundCount: 5, seed: 70 });
    const stats = spreadStats(result);
    expect(stats.gamesWithConsecutiveCountry).toBe(0);
    expect(stats.gamesWithClusterPair).toBe(0);
    expect(stats.countriesPerGame).toBe(5);
  });

  it('relaxes the country rule only where the real catalog forces it', () => {
    const games = 300;
    const result = simulateGames({ all: LOCATIONS, games, roundCount: 5, seed: 71 });
    const stats = spreadStats(result);

    // The Normal tier holds 21 places and only one country (Canada) appears
    // twice. When a cycle's last few places happen to be that pair, adjacency
    // is unavoidable — the rule is soft precisely so the game still starts.
    // What must stay true is that relaxation is rare and never routine.
    expect(stats.gamesWithConsecutiveCountry).toBeLessThan(games * 0.02);
    // The cluster rule is never forced on this catalog: no two places are
    // within 25 km of each other (see docs/DATASET_AUDIT.md).
    expect(stats.gamesWithClusterPair).toBe(0);
    expect(stats.continentsPerGame).toBeGreaterThanOrEqual(3);
  });

  it('gives a five-round game broad variety on the real catalog', () => {
    const result = simulateGames({ all: LOCATIONS, games: 200, roundCount: 5, seed: 73 });
    const stats = spreadStats(result);
    // Five rounds, five different countries, at least three continents.
    expect(stats.countriesPerGame).toBeGreaterThan(4.8);
    expect(stats.continentsPerGame).toBeGreaterThan(3.4);
  });

  it('respects a themed collection even where continent spread is impossible', () => {
    const result = simulateGames({
      all: LOCATIONS,
      games: 100,
      roundCount: 3,
      collection: 'europe',
      seed: 74,
    });
    expect(result.gamesOffCollection).toBe(0);
    for (const locations of result.gameLocations) {
      expect(locations.every((l) => l.continent === 'Europe')).toBe(true);
    }
    expect(spreadStats(result).gamesWithConsecutiveCountry).toBe(0);
  });
});

describe('termination and degenerate pools', () => {
  it('terminates for pools far smaller than the game', () => {
    for (const size of [0, 1, 2, 3]) {
      for (const roundCount of GAME_ROUND_COUNTS) {
        const result = simulateGames({
          all: syntheticCatalog(size),
          games: 20,
          roundCount,
          seed: size + roundCount,
        });
        expect(result.gamesWithDuplicates).toBe(0);
        expect(result.totalRounds).toBe(20 * Math.min(size, roundCount));
      }
    }
  });

  it('terminates for a single-place pool', () => {
    const result = simulateGames({ all: syntheticCatalog(1), games: 50, roundCount: 5, seed: 8 });
    expect(result.games.every((g) => g.length === 1)).toBe(true);
  });

  it('terminates for an empty collection', () => {
    // No catalog entry carries the `rural` tag today, so this is the real
    // "collection exists but is empty" case, not a synthetic one.
    const result = simulateGames({
      all: LOCATIONS,
      games: 10,
      roundCount: 5,
      collection: 'rural',
      seed: 9,
    });
    expect(result.totalRounds).toBe(0);
  });

  it('terminates when the whole pool sits in one country and one cluster', () => {
    const oneSpot: GameLocation[] = Array.from({ length: 8 }, (_, i) => ({
      id: `spot-${i}`,
      lat: 48.85 + i * 0.02,
      lng: 2.29,
      label: `spot-${i}`,
      country: 'France',
      continent: 'Europe',
      difficulty: 'normal',
    }));
    const result = simulateGames({ all: oneSpot, games: 20, roundCount: 5, seed: 10 });
    expect(result.gamesWithDuplicates).toBe(0);
    expect(result.games.every((g) => g.length === 5)).toBe(true);
  });
});

describe('simulation audit summary', () => {
  it('reports the headline numbers for the shipped catalog', () => {
    const lines: string[] = [];
    for (const roundCount of GAME_ROUND_COUNTS) {
      const result = simulateGames({
        all: LOCATIONS,
        games: 100,
        roundCount,
        seed: 1000 + roundCount,
      });
      lines.push(summarise(`catalog ${roundCount}-round`, result));
      expect(result.gamesWithDuplicates).toBe(0);
    }
    // Printed so a reviewer can read the actual behaviour, not just a pass.
    console.info(`\n${lines.join('\n')}\n`);
    expect(lines).toHaveLength(GAME_ROUND_COUNTS.length);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { StaticLocationProvider } from './LocationProvider';
import { LOCATION_HISTORY_KEY, readLocationHistory } from '../utils/locationHistory';
import { SHUFFLE_BAG_KEY } from '../diversity/bagStorage';
import { commitRoundStarted } from '../diversity/store';

/**
 * Fixtures are spread geographically on purpose. The Diversity Engine selects
 * canonical *places*, so several rows at one coordinate are one selectable
 * item — a fixture that shares coordinates would be testing grouping, not
 * selection.
 */
function loc(id: string, index: number, difficulty: Difficulty = 'normal'): GameLocation {
  return {
    id,
    lat: -80 + (index % 30) * 5,
    lng: -170 + Math.floor(index / 30) * 40 + (index % 30) * 2,
    label: id,
    country: 'Nowhere',
    difficulty,
  };
}

const makePool = (n: number, prefix = 'n', difficulty: Difficulty = 'normal') =>
  Array.from({ length: n }, (_, i) => loc(`${prefix}${i}`, i, difficulty));

/** Play a whole selection: commit each round as if it had actually started. */
async function playGame(
  provider: StaticLocationProvider,
  all: GameLocation[],
  count: number,
  difficulty: Difficulty = 'normal',
): Promise<string[]> {
  const { locations, groupIds } = await provider.getGameLocations(count, difficulty);
  for (const groupId of groupIds) {
    commitRoundStarted({ all, groupId, count, difficulty });
  }
  return locations.map((l) => l.id);
}

afterEach(() => {
  window.localStorage.clear();
});

describe('StaticLocationProvider.getGameLocations', () => {
  it('never returns duplicate locations within one match', async () => {
    const pool = makePool(20);
    const { locations } = await new StaticLocationProvider(pool).getGameLocations(5, 'normal');
    expect(locations).toHaveLength(5);
    expect(new Set(locations.map((l) => l.id)).size).toBe(5);
  });

  it('never serves two rows of the same canonical place in one match', async () => {
    // Four places, one of them present twice under different ids.
    const twin = loc('lookout-east', 4);
    const pool = [...makePool(4), { ...twin, id: 'lookout-west' }, twin];
    const { locations } = await new StaticLocationProvider(pool).getGameLocations(5, 'normal');
    const ids = locations.map((l) => l.id);
    expect(ids).not.toEqual(expect.arrayContaining(['lookout-east', 'lookout-west']));
    // Five rounds were requested but only five distinct *places* exist, one of
    // which is duplicated — so the game is one round short rather than repeated.
    expect(locations).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('reports insufficiency instead of padding with repeats', async () => {
    const pool = makePool(3);
    const result = await new StaticLocationProvider(pool).getGameLocations(5, 'normal');
    expect(result.locations).toHaveLength(3);
    expect(result.sufficient).toBe(false);
  });

  it('records nothing at selection time', async () => {
    const pool = makePool(10);
    await new StaticLocationProvider(pool).getGameLocations(5, 'normal');
    // A selection that is never played must not cost the player any freshness.
    expect(readLocationHistory()).toEqual([]);
    expect(window.localStorage.getItem(SHUFFLE_BAG_KEY)).toBeNull();
  });

  it('records a place once its round has started', async () => {
    const pool = makePool(10);
    const provider = new StaticLocationProvider(pool);
    const { groupIds } = await provider.getGameLocations(5, 'normal');
    commitRoundStarted({ all: pool, groupId: groupIds[0], count: 5, difficulty: 'normal' });
    expect(readLocationHistory()).toEqual([groupIds[0]]);
  });

  it('avoids places played in the very previous match', async () => {
    const pool = makePool(10);
    const provider = new StaticLocationProvider(pool);

    const first = new Set(await playGame(provider, pool, 5));
    const second = await playGame(provider, pool, 5);

    // Ten places, five played: the second match draws entirely from the rest.
    expect(second.filter((id) => first.has(id))).toHaveLength(0);
  });

  it('serves every place before repeating any (full bag cycle)', async () => {
    const pool = makePool(20);
    const provider = new StaticLocationProvider(pool);

    const seen: string[] = [];
    for (let game = 0; game < 4; game++) {
      seen.push(...(await playGame(provider, pool, 5)));
    }
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  it('reshuffles into a new cycle rather than repeating the same order', async () => {
    const pool = makePool(10);
    const provider = new StaticLocationProvider(pool);

    const cycleOne: string[] = [];
    for (let game = 0; game < 2; game++) cycleOne.push(...(await playGame(provider, pool, 5)));
    const cycleTwo: string[] = [];
    for (let game = 0; game < 2; game++) cycleTwo.push(...(await playGame(provider, pool, 5)));

    expect(new Set(cycleTwo).size).toBe(10);
    // Same places (the pool is exhausted), but not the same order.
    expect(cycleTwo).not.toEqual(cycleOne);
  });

  it('still applies difficulty filtering with history in play', async () => {
    const pool = [
      ...makePool(6, 'e', 'easy'),
      ...makePool(6, 'n', 'normal'),
      ...makePool(6, 'h', 'hard'),
    ];
    const provider = new StaticLocationProvider(pool);
    await playGame(provider, pool, 3, 'easy');
    const { locations } = await provider.getGameLocations(3, 'easy');
    for (const l of locations) expect(l.difficulty).toBe('easy');
  });

  it('keeps difficulty bags independent', async () => {
    const pool = [...makePool(6, 'e', 'easy'), ...makePool(6, 'n', 'normal')];
    const provider = new StaticLocationProvider(pool);

    // Exhaust the easy cycle entirely…
    await playGame(provider, pool, 6, 'easy');
    // …then a normal game must still see a full, untouched normal cycle.
    const normal = await provider.getGameLocations(6, 'normal');
    expect(new Set(normal.groupIds).size).toBe(6);
    expect(normal.sufficient).toBe(true);
  });

  it('falls back to least-recently-played places instead of failing', async () => {
    const pool = makePool(5);
    const provider = new StaticLocationProvider(pool);

    await playGame(provider, pool, 4);
    const second = await provider.getGameLocations(5, 'normal');
    expect(second.locations).toHaveLength(5);
    expect(new Set(second.locations.map((l) => l.id)).size).toBe(5);
    // The one place never played leads, because the cycle still owed it.
    expect(second.groupIds[0]).toBe(
      pool.map((l) => l.id).find((id) => !readLocationHistory().includes(id)),
    );
  });

  it('keeps working when stored history is malformed', async () => {
    window.localStorage.setItem(LOCATION_HISTORY_KEY, '{not json');
    window.localStorage.setItem(SHUFFLE_BAG_KEY, '[[[');
    const pool = makePool(5);
    const { locations } = await new StaticLocationProvider(pool).getGameLocations(5, 'normal');
    expect(locations).toHaveLength(5);
    expect(new Set(locations.map((l) => l.id)).size).toBe(5);
  });

  it('is deterministic for a given RNG', async () => {
    const pool = makePool(20);
    const seeded = () => {
      let n = 1;
      return () => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };
    };
    const a = await new StaticLocationProvider(pool).getGameLocations(5, 'normal', {
      rng: seeded(),
    });
    const b = await new StaticLocationProvider(pool).getGameLocations(5, 'normal', {
      rng: seeded(),
    });
    expect(a.locations.map((l) => l.id)).toEqual(b.locations.map((l) => l.id));
  });

  it('does not simply follow catalog order', async () => {
    // Selection must not be predictable from the order (or the ids) of the
    // catalog — a public, sequentially-named pool must still shuffle.
    const pool = makePool(30);
    const catalogOrder = pool.slice(0, 10).map((l) => l.id);
    const { locations } = await new StaticLocationProvider(pool).getGameLocations(10, 'normal');
    expect(locations.map((l) => l.id)).not.toEqual(catalogOrder);
  });
});

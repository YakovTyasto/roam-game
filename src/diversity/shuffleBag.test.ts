import { describe, expect, it } from 'vitest';
import {
  EMPTY_BAG,
  RECENCY_BUCKET_SIZE,
  drawFromBag,
  fisherYatesShuffle,
  markDrawn,
  orderByNovelty,
  remainingInCycle,
} from './shuffleBag';
import { seededRng } from './__fixtures__/rng';

const id = (s: string): string => s;

describe('fisherYatesShuffle', () => {
  it('preserves every element exactly once', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = fisherYatesShuffle(input, seededRng(7));
    expect(out).toHaveLength(50);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4];
    fisherYatesShuffle(input, seededRng(3));
    expect(input).toEqual([1, 2, 3, 4]);
  });

  it('is deterministic for a given seed and varies between seeds', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    expect(fisherYatesShuffle(input, seededRng(1))).toEqual(fisherYatesShuffle(input, seededRng(1)));
    expect(fisherYatesShuffle(input, seededRng(1))).not.toEqual(
      fisherYatesShuffle(input, seededRng(2)),
    );
  });

  it('produces a roughly uniform distribution of first positions', () => {
    // A biased "shuffle" (e.g. sort(() => Math.random() - 0.5)) fails this.
    const items = ['a', 'b', 'c', 'd', 'e'];
    const rng = seededRng(99);
    const counts = new Map(items.map((i) => [i, 0]));
    const trials = 20000;
    for (let i = 0; i < trials; i++) {
      const first = fisherYatesShuffle(items, rng)[0];
      counts.set(first, counts.get(first)! + 1);
    }
    const expected = trials / items.length;
    for (const count of counts.values()) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.1);
    }
  });
});

describe('orderByNovelty', () => {
  it('puts never-seen items before recently-seen ones', () => {
    const items = ['seen', 'fresh'];
    const out = orderByNovelty(items, id, ['seen'], seededRng(1));
    expect(out[0]).toBe('fresh');
  });

  it('prefers older recency buckets among seen items', () => {
    // History newest-first: `new` is in bucket 0, `old` far enough back to be
    // in a later bucket.
    const history = ['new', ...Array.from({ length: RECENCY_BUCKET_SIZE * 3 }, (_, i) => `x${i}`), 'old'];
    const out = orderByNovelty(['new', 'old'], id, history, seededRng(1));
    expect(out).toEqual(['old', 'new']);
  });

  it('randomises order within one recency bucket', () => {
    // All three share bucket 0, so the order must not be fixed by position.
    const history = ['a', 'b', 'c'];
    const orders = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      orders.add(orderByNovelty(['a', 'b', 'c'], id, history, seededRng(seed)).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('handles an empty history', () => {
    const out = orderByNovelty(['a', 'b', 'c'], id, [], seededRng(5));
    expect([...out].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('markDrawn', () => {
  const pool = new Set(['a', 'b', 'c']);

  it('accumulates drawn keys', () => {
    expect(markDrawn(EMPTY_BAG, ['a'], pool)).toEqual({ drawn: ['a'], cycle: 0 });
  });

  it('clears the bag and advances the cycle when the pool is exhausted', () => {
    const state = markDrawn(EMPTY_BAG, ['a', 'b', 'c'], pool);
    expect(state).toEqual({ drawn: [], cycle: 1 });
  });

  it('wraps into a new cycle when a key repeats', () => {
    const state = markDrawn({ drawn: ['a'], cycle: 0 }, ['a'], pool);
    expect(state).toEqual({ drawn: ['a'], cycle: 1 });
  });

  it('ignores keys outside the pool so a retired location cannot wedge a cycle', () => {
    expect(markDrawn(EMPTY_BAG, ['retired'], pool)).toEqual({ drawn: [], cycle: 0 });
  });

  it('prunes stale keys when the pool shrinks', () => {
    const smaller = new Set(['a', 'b']);
    const state = markDrawn({ drawn: ['a', 'gone'], cycle: 2 }, [], smaller);
    expect(state.drawn).toEqual(['a']);
  });

  it('gives the same result applied incrementally or in one go', () => {
    const atOnce = markDrawn(EMPTY_BAG, ['a', 'b'], pool);
    const oneByOne = markDrawn(markDrawn(EMPTY_BAG, ['a'], pool), ['b'], pool);
    expect(oneByOne).toEqual(atOnce);
  });

  it('keeps state bounded by the pool size', () => {
    const big = new Set(Array.from({ length: 40 }, (_, i) => `k${i}`));
    let state = EMPTY_BAG;
    for (let i = 0; i < 500; i++) state = markDrawn(state, [`k${i % 40}`], big);
    expect(state.drawn.length).toBeLessThanOrEqual(40);
  });
});

describe('drawFromBag', () => {
  const items = Array.from({ length: 10 }, (_, i) => `k${i}`);
  const draw = (count: number, state = EMPTY_BAG, seed = 1) =>
    drawFromBag({ items, count, keyOf: id, state, rng: seededRng(seed) });

  it('returns the requested count with no duplicates', () => {
    const { picked } = draw(5);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
  });

  it('deals every item once before repeating any', () => {
    let state = EMPTY_BAG;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const result = drawFromBag({ items, count: 2, keyOf: id, state, rng: seededRng(i + 1) });
      seen.push(...result.picked);
      state = result.nextState;
    }
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it('collapses items sharing a canonical group into one slot', () => {
    const twins = ['a1', 'a2', 'b', 'c'];
    const groupOf = (k: string) => (k.startsWith('a') ? 'a' : k);
    const { picked } = drawFromBag({
      items: twins,
      count: 4,
      keyOf: groupOf,
      state: EMPTY_BAG,
      rng: seededRng(1),
    });
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map(groupOf)).size).toBe(3);
  });

  it('reports a new cycle and still avoids duplicates when it wraps', () => {
    const state = markDrawn(EMPTY_BAG, items.slice(0, 8), new Set(items));
    const result = drawFromBag({ items, count: 5, keyOf: id, state, rng: seededRng(2) });
    expect(result.startedNewCycle).toBe(true);
    expect(result.picked).toHaveLength(5);
    expect(new Set(result.picked).size).toBe(5);
  });

  it('returns the whole pool rather than failing when it is too small', () => {
    const { picked } = drawFromBag({
      items: ['a', 'b'],
      count: 5,
      keyOf: id,
      state: EMPTY_BAG,
      rng: seededRng(1),
    });
    expect(picked).toEqual(expect.arrayContaining(['a', 'b']));
    expect(picked).toHaveLength(2);
  });

  it('returns backups that never overlap the picks', () => {
    const { picked, backups } = drawFromBag({
      items,
      count: 3,
      keyOf: id,
      state: EMPTY_BAG,
      rng: seededRng(4),
      backupCount: 4,
    });
    expect(backups).toHaveLength(4);
    expect(picked.filter((p) => backups.includes(p))).toHaveLength(0);
  });

  it('does not mutate the supplied state', () => {
    const state = { drawn: ['k0'], cycle: 3 };
    draw(2, state);
    expect(state).toEqual({ drawn: ['k0'], cycle: 3 });
  });

  it('handles a zero count and an empty pool', () => {
    expect(draw(0).picked).toEqual([]);
    expect(
      drawFromBag({ items: [], count: 5, keyOf: id, state: EMPTY_BAG, rng: seededRng(1) }).picked,
    ).toEqual([]);
  });

  it('ignores an arrange hook that adds, drops or duplicates items', () => {
    const { picked } = drawFromBag({
      items,
      count: 3,
      keyOf: id,
      state: EMPTY_BAG,
      rng: seededRng(1),
      arrange: () => ['k0', 'k0', 'k0'],
    });
    expect(new Set(picked).size).toBe(3);
  });

  it('applies a well-behaved arrange hook', () => {
    const { picked } = drawFromBag({
      items,
      count: 3,
      keyOf: id,
      state: EMPTY_BAG,
      rng: seededRng(1),
      arrange: (ranked) => [...ranked].reverse(),
    });
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it('is deterministic for a given seed', () => {
    expect(draw(5, EMPTY_BAG, 42).picked).toEqual(draw(5, EMPTY_BAG, 42).picked);
  });

  it('does not follow the pool order', () => {
    expect(draw(10).picked).not.toEqual(items);
  });
});

describe('remainingInCycle', () => {
  it('counts undealt pool members and ignores stale keys', () => {
    const pool = new Set(['a', 'b', 'c']);
    expect(remainingInCycle(EMPTY_BAG, pool)).toBe(3);
    expect(remainingInCycle({ drawn: ['a', 'retired'], cycle: 0 }, pool)).toBe(2);
  });
});

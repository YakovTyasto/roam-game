import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_BAGS,
  MAX_DRAWN_PER_BAG,
  SHUFFLE_BAG_KEY,
  bagKey,
  readBag,
  resetBags,
  writeBag,
} from './bagStorage';
import { EMPTY_BAG } from './shuffleBag';

afterEach(() => {
  window.localStorage.clear();
});

describe('bagKey', () => {
  it('separates difficulties and collections', () => {
    expect(bagKey('easy', 'world')).not.toBe(bagKey('hard', 'world'));
    expect(bagKey('easy', 'world')).not.toBe(bagKey('easy', 'islands'));
  });
});

describe('readBag / writeBag', () => {
  it('round-trips a bag', () => {
    writeBag('easy:world', { drawn: ['a', 'b'], cycle: 3 });
    expect(readBag('easy:world')).toEqual({ drawn: ['a', 'b'], cycle: 3 });
  });

  it('returns an empty bag for an unknown key', () => {
    expect(readBag('nothing:here')).toEqual(EMPTY_BAG);
  });

  it('keeps bags independent', () => {
    writeBag('easy:world', { drawn: ['a'], cycle: 1 });
    writeBag('hard:world', { drawn: ['b'], cycle: 2 });
    expect(readBag('easy:world').drawn).toEqual(['a']);
    expect(readBag('hard:world').drawn).toEqual(['b']);
  });

  it('deduplicates drawn ids on write', () => {
    writeBag('easy:world', { drawn: ['a', 'a', 'b'], cycle: 0 });
    expect(readBag('easy:world').drawn).toEqual(['a', 'b']);
  });
});

describe('bounded storage', () => {
  it('evicts the least recently used bags beyond MAX_BAGS', () => {
    for (let i = 0; i < MAX_BAGS + 5; i++) {
      writeBag(`bag-${i}`, { drawn: [`x${i}`], cycle: 0 }, 1000 + i);
    }
    const stored = JSON.parse(window.localStorage.getItem(SHUFFLE_BAG_KEY)!) as {
      bags: Record<string, unknown>;
    };
    expect(Object.keys(stored.bags)).toHaveLength(MAX_BAGS);
    // The newest survive, the oldest are gone.
    expect(stored.bags[`bag-${MAX_BAGS + 4}`]).toBeDefined();
    expect(stored.bags['bag-0']).toBeUndefined();
  });

  it('caps the ids stored inside one bag', () => {
    const huge = Array.from({ length: MAX_DRAWN_PER_BAG + 50 }, (_, i) => `k${i}`);
    writeBag('easy:world', { drawn: huge, cycle: 0 });
    expect(readBag('easy:world').drawn).toHaveLength(MAX_DRAWN_PER_BAG);
  });
});

describe('malformed storage', () => {
  it('survives invalid JSON', () => {
    window.localStorage.setItem(SHUFFLE_BAG_KEY, '{not json');
    expect(readBag('easy:world')).toEqual(EMPTY_BAG);
  });

  it('survives a wrong version', () => {
    window.localStorage.setItem(SHUFFLE_BAG_KEY, JSON.stringify({ version: 99, bags: {} }));
    expect(readBag('easy:world')).toEqual(EMPTY_BAG);
  });

  it('survives a bag whose shape is wrong', () => {
    window.localStorage.setItem(
      SHUFFLE_BAG_KEY,
      JSON.stringify({ version: 1, bags: { 'easy:world': { drawn: 'nope', cycle: 'x' } } }),
    );
    expect(readBag('easy:world')).toEqual(EMPTY_BAG);
  });

  it('drops junk entries inside a valid bag', () => {
    window.localStorage.setItem(
      SHUFFLE_BAG_KEY,
      JSON.stringify({
        version: 1,
        bags: { 'easy:world': { drawn: ['a', 42, null, '', 'b'], cycle: -5 } },
      }),
    );
    expect(readBag('easy:world')).toEqual({ drawn: ['a', 'b'], cycle: 0 });
  });

  it('keeps other bags usable when one is corrupt', () => {
    window.localStorage.setItem(
      SHUFFLE_BAG_KEY,
      JSON.stringify({
        version: 1,
        bags: { broken: null, 'easy:world': { drawn: ['a'], cycle: 1 } },
      }),
    );
    expect(readBag('easy:world')).toEqual({ drawn: ['a'], cycle: 1 });
    expect(readBag('broken')).toEqual(EMPTY_BAG);
  });
});

describe('resetBags', () => {
  it('clears every bag', () => {
    writeBag('easy:world', { drawn: ['a'], cycle: 1 });
    resetBags();
    expect(readBag('easy:world')).toEqual(EMPTY_BAG);
  });
});

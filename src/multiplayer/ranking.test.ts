import { describe, expect, it } from 'vitest';
import { rankByScore, rankPlayersByTotal, ordinal } from './ranking';
import { party } from './__fixtures__/rooms';

describe('rankByScore (competition ranking)', () => {
  it('ranks distinct scores 1..N', () => {
    const ranked = rankByScore([{ s: 10 }, { s: 30 }, { s: 20 }], (x) => x.s);
    expect(ranked.map((r) => [r.item.s, r.rank])).toEqual([
      [30, 1],
      [20, 2],
      [10, 3],
    ]);
  });

  it('shares a rank on ties and skips the next (1,2,2,4)', () => {
    const ranked = rankByScore(
      [{ s: 50 }, { s: 40 }, { s: 40 }, { s: 10 }],
      (x) => x.s,
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranked[1].tied).toBe(true);
    expect(ranked[2].tied).toBe(true);
    expect(ranked[3].tied).toBe(false);
  });

  it('flags every top-score entry as a winner on a tie for first', () => {
    const ranked = rankByScore([{ s: 100 }, { s: 100 }, { s: 5 }], (x) => x.s);
    expect(ranked.filter((r) => r.isWinner)).toHaveLength(2);
  });

  it('is stable under an explicit tie-break', () => {
    const ranked = rankByScore(
      [{ s: 10, id: 'b' }, { s: 10, id: 'a' }],
      (x) => x.s,
      (a, b) => a.id.localeCompare(b.id),
    );
    expect(ranked.map((r) => r.item.id)).toEqual(['a', 'b']);
  });
});

describe('rankPlayersByTotal', () => {
  it('orders an 8-player party by total score', () => {
    const players = party(8, [0, 700, 100, 700, 900, 50, 900, 20]);
    const ranked = rankPlayersByTotal(players);
    // Two 900s tie for 1st, two 700s tie for 3rd.
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1);
    expect(ranked.filter((r) => r.score === 700).every((r) => r.rank === 3)).toBe(true);
  });
});

describe('ordinal', () => {
  it('formats ordinals', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(21)).toBe('21st');
  });
});

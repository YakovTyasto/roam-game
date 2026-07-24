import type { MpPlayer } from './types';

/**
 * Generic N-player ranking (2–8 players). Ranks by a numeric score descending
 * using *competition ranking* (1, 2, 2, 4): tied scores share a rank and the
 * next rank skips accordingly. Pure and total.
 */
export interface RankedEntry<T> {
  item: T;
  score: number;
  /** 1-based competition rank (ties share a rank). */
  rank: number;
  /** True when this entry is tied with at least one other at the same rank. */
  tied: boolean;
  /** True when this entry shares the top rank (rank === 1). */
  isWinner: boolean;
}

/**
 * Rank items by `scoreOf` (descending). A stable secondary sort key keeps the
 * order deterministic for equal scores (e.g. player slot) without affecting the
 * competition rank they share.
 */
export function rankByScore<T>(
  items: readonly T[],
  scoreOf: (item: T) => number,
  tieBreak: (a: T, b: T) => number = () => 0,
): RankedEntry<T>[] {
  const sorted = [...items].sort((a, b) => {
    const diff = scoreOf(b) - scoreOf(a);
    return diff !== 0 ? diff : tieBreak(a, b);
  });

  const result: RankedEntry<T>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const score = scoreOf(sorted[i]);
    // Competition rank: 1 + number of items strictly ahead on score.
    const rank = 1 + sorted.filter((o) => scoreOf(o) > score).length;
    const tied = sorted.filter((o) => scoreOf(o) === score).length > 1;
    result.push({ item: sorted[i], score, rank, tied, isWinner: rank === 1 });
  }
  return result;
}

/** Rank players by total score, breaking ties by slot for a stable order. */
export function rankPlayersByTotal(players: readonly MpPlayer[]): RankedEntry<MpPlayer>[] {
  return rankByScore(
    players,
    (p) => p.totalScore,
    (a, b) => a.slot - b.slot,
  );
}

/** Ordinal suffix for a rank ("1st", "2nd", "3rd", "4th"…). */
export function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

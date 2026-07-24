import type { Difficulty } from '../config/difficulty';

export type LeaderboardMode = 'solo' | 'multiplayer';

/** One sanitized public leaderboard row (never contains a user UUID). */
export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  bestScore: number;
  gamesCompleted: number;
  wins: number;
  avgScore: number;
  isSelf: boolean;
}

export interface LeaderboardData {
  weekStart: string;
  weekEnd: string;
  mode: LeaderboardMode;
  difficulty: Difficulty;
  entries: LeaderboardEntry[];
  /** The caller's own entry, even when outside the returned top N. */
  self: LeaderboardEntry | null;
}

import type { MpPlayer, RoomSnapshot } from './types';
import { rankByScore, rankPlayersByTotal } from './ranking';

/** One player's outcome in a single completed round. */
export interface PlayerRoundResult {
  userId: string;
  displayName: string;
  slot: number;
  score: number;
  distanceKm: number | null;
  /** True if the player never guessed this round (timed out / left). */
  missed: boolean;
  rank: number;
  tied: boolean;
  isMe: boolean;
}

export interface RoundSummary {
  roundNumber: number;
  label: string;
  country: string;
  /** All players ranked for this round (best first). */
  results: PlayerRoundResult[];
}

/** One player's final standing in the match. */
export interface FinalStanding {
  userId: string;
  displayName: string;
  slot: number;
  totalScore: number;
  rank: number;
  tied: boolean;
  isWinner: boolean;
  isMe: boolean;
  left: boolean;
}

export interface MatchSummary {
  rounds: RoundSummary[];
  standings: FinalStanding[];
  /** My final standing, or null if I am not among the players. */
  me: FinalStanding | null;
  /** All players sharing rank 1. */
  winners: FinalStanding[];
  /** True when more than one player shares the top rank. */
  isTie: boolean;
}

/**
 * Build a per-round + overall breakdown of a completed match from the
 * authoritative snapshot, for 2–8 players, from the perspective of `meUserId`.
 * Pure and testable — the final screen renders exactly this.
 */
export function summarizeMatch(snapshot: RoomSnapshot, meUserId: string): MatchSummary {
  const players = [...snapshot.players].sort((a, b) => a.slot - b.slot);
  const nameOf = (p: MpPlayer) => p.displayName;

  const completedRounds = snapshot.rounds
    .filter((r) => r.status === 'complete')
    .sort((a, b) => a.roundNumber - b.roundNumber);

  const rounds: RoundSummary[] = completedRounds.map((round) => {
    const target = snapshot.targets.find((t) => t.roundId === round.id);
    const scoreFor = (p: MpPlayer) =>
      snapshot.guesses.find((g) => g.roundId === round.id && g.userId === p.userId)?.score ?? 0;

    const ranked = rankByScore(players, scoreFor, (a, b) => a.slot - b.slot);
    const results: PlayerRoundResult[] = ranked.map((entry) => {
      const p = entry.item;
      const guess = snapshot.guesses.find(
        (g) => g.roundId === round.id && g.userId === p.userId,
      );
      return {
        userId: p.userId,
        displayName: nameOf(p),
        slot: p.slot,
        score: entry.score,
        distanceKm: guess?.distanceKm ?? null,
        missed: !guess,
        rank: entry.rank,
        tied: entry.tied,
        isMe: p.userId === meUserId,
      };
    });

    return {
      roundNumber: round.roundNumber,
      label: target?.label ?? `Round ${round.roundNumber}`,
      country: target?.country ?? '',
      results,
    };
  });

  const finalRanked = rankPlayersByTotal(players);
  const standings: FinalStanding[] = finalRanked.map((entry) => ({
    userId: entry.item.userId,
    displayName: nameOf(entry.item),
    slot: entry.item.slot,
    totalScore: entry.score,
    rank: entry.rank,
    tied: entry.tied,
    isWinner: entry.isWinner,
    isMe: entry.item.userId === meUserId,
    left: entry.item.connectionStatus === 'left',
  }));

  const me = standings.find((s) => s.isMe) ?? null;
  const winners = standings.filter((s) => s.isWinner);

  return { rounds, standings, me, winners, isTie: winners.length > 1 };
}

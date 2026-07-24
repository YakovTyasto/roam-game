import type { RoomSnapshot } from './types';
import { outcomeForSlot, computeMatchOutcome, outcomeFromScores } from './outcome';

export interface RoundSummary {
  roundNumber: number;
  label: string;
  country: string;
  myScore: number;
  myDistanceKm: number | null;
  oppScore: number;
  oppDistanceKm: number | null;
  /** From the current player's perspective. */
  result: 'win' | 'loss' | 'draw';
}

export interface MatchSummary {
  rounds: RoundSummary[];
  myTotal: number;
  oppTotal: number;
  /** From the current player's perspective. */
  result: 'win' | 'loss' | 'draw';
}

/**
 * Build a per-round + overall breakdown of a completed match from the
 * authoritative snapshot, from the perspective of `meUserId`. Pure and
 * testable — the final screen renders exactly this.
 */
export function summarizeMatch(
  snapshot: RoomSnapshot,
  meUserId: string,
  oppUserId: string | null,
): MatchSummary {
  const me = snapshot.players.find((p) => p.userId === meUserId) ?? null;
  const mySlot = me?.slot ?? 1;

  const completedRounds = snapshot.rounds
    .filter((r) => r.status === 'complete')
    .sort((a, b) => a.roundNumber - b.roundNumber);

  const rounds: RoundSummary[] = completedRounds.map((round) => {
    const target = snapshot.targets.find((t) => t.roundId === round.id);
    const myGuess = snapshot.guesses.find(
      (g) => g.roundId === round.id && g.userId === meUserId,
    );
    const oppGuess = oppUserId
      ? snapshot.guesses.find((g) => g.roundId === round.id && g.userId === oppUserId)
      : undefined;

    const myScore = myGuess?.score ?? 0;
    const oppScore = oppGuess?.score ?? 0;
    const outcome = outcomeFromScores(myScore, oppScore); // p1 = me here

    return {
      roundNumber: round.roundNumber,
      label: target?.label ?? `Round ${round.roundNumber}`,
      country: target?.country ?? '',
      myScore,
      myDistanceKm: myGuess?.distanceKm ?? null,
      oppScore,
      oppDistanceKm: oppGuess?.distanceKm ?? null,
      result: outcome === 'p1' ? 'win' : outcome === 'p2' ? 'loss' : 'draw',
    };
  });

  const myTotal = me?.totalScore ?? 0;
  const opp = oppUserId
    ? snapshot.players.find((p) => p.userId === oppUserId) ?? null
    : null;
  const oppTotal = opp?.totalScore ?? 0;

  const matchOutcome = computeMatchOutcome(snapshot.players);
  const result = outcomeForSlot(matchOutcome, mySlot === 2 ? 2 : 1);

  return { rounds, myTotal, oppTotal, result };
}

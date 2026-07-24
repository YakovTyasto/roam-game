import type { MpPlayer, Outcome } from './types';

/**
 * Decide a winner from two scores. Slot 1 wins ties? No — equal scores are a
 * draw. Higher score wins. Pure and total.
 */
export function outcomeFromScores(slot1Score: number, slot2Score: number): Outcome {
  if (slot1Score > slot2Score) return 'p1';
  if (slot2Score > slot1Score) return 'p2';
  return 'draw';
}

/**
 * Compute the match outcome from the two players. Players are matched to slots
 * so the result is stable regardless of array order. If a slot is missing, the
 * present player is treated as the winner (defensive; shouldn't happen in a
 * completed 2-player match).
 */
export function computeMatchOutcome(players: MpPlayer[]): Outcome {
  const p1 = players.find((p) => p.slot === 1);
  const p2 = players.find((p) => p.slot === 2);
  if (p1 && !p2) return 'p1';
  if (p2 && !p1) return 'p2';
  if (!p1 || !p2) return 'draw';
  return outcomeFromScores(p1.totalScore, p2.totalScore);
}

/**
 * Map an outcome to whether a specific slot won ('win' | 'loss' | 'draw'),
 * used to label results from a given player's perspective.
 */
export function outcomeForSlot(
  outcome: Outcome,
  slot: 1 | 2,
): 'win' | 'loss' | 'draw' {
  if (outcome === 'draw') return 'draw';
  const winnerSlot = outcome === 'p1' ? 1 : 2;
  return winnerSlot === slot ? 'win' : 'loss';
}

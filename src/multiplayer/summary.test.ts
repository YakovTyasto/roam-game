import { describe, it, expect } from 'vitest';
import { summarizeMatch } from './summary';
import {
  ME,
  OPP,
  makeGuess,
  makeRoom,
  makeRound,
  makeSnapshot,
  makeTarget,
  twoPlayers,
} from './__fixtures__/rooms';

function completedMatch(meScore: number, oppScore: number) {
  // Two completed rounds; totals live on the players.
  const r1 = makeRound({ id: 'r1', roundNumber: 1, status: 'complete' });
  const r2 = makeRound({ id: 'r2', roundNumber: 2, status: 'complete' });
  return makeSnapshot({
    room: makeRoom({ status: 'complete', currentRound: 2 }),
    players: twoPlayers(meScore, oppScore),
    rounds: [r1, r2],
    targets: [
      makeTarget({ roundId: 'r1', label: 'Paris' }),
      makeTarget({ roundId: 'r2', label: 'Tokyo' }),
    ],
    guesses: [
      makeGuess({ id: 'g1', roundId: 'r1', userId: ME, playerId: 'player-me', score: 4000, distanceKm: 120 }),
      makeGuess({ id: 'g2', roundId: 'r1', userId: OPP, playerId: 'player-opp', score: 3000, distanceKm: 300 }),
      makeGuess({ id: 'g3', roundId: 'r2', userId: ME, playerId: 'player-me', score: 1000, distanceKm: 2000 }),
      // Opponent missed round 2 (no guess) → 0.
    ],
  });
}

describe('summarizeMatch', () => {
  it('builds a per-round breakdown from the current player perspective', () => {
    const snap = completedMatch(5000, 3000);
    const summary = summarizeMatch(snap, ME, OPP);

    expect(summary.rounds).toHaveLength(2);
    expect(summary.rounds[0]).toMatchObject({
      roundNumber: 1,
      label: 'Paris',
      myScore: 4000,
      oppScore: 3000,
      result: 'win',
    });
    expect(summary.rounds[1]).toMatchObject({
      roundNumber: 2,
      myScore: 1000,
      oppScore: 0,
      oppDistanceKm: null, // opponent missed the round
      result: 'win',
    });
  });

  it('reports the overall winner from the player totals', () => {
    expect(summarizeMatch(completedMatch(5000, 3000), ME, OPP).result).toBe('win');
    expect(summarizeMatch(completedMatch(2000, 9000), ME, OPP).result).toBe('loss');
    expect(summarizeMatch(completedMatch(4000, 4000), ME, OPP).result).toBe('draw');
  });

  it('carries the player totals through', () => {
    const summary = summarizeMatch(completedMatch(5000, 3000), ME, OPP);
    expect(summary.myTotal).toBe(5000);
    expect(summary.oppTotal).toBe(3000);
  });
});

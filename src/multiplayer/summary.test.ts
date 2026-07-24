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
  party,
} from './__fixtures__/rooms';

function completedMatch(meScore: number, oppScore: number) {
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

describe('summarizeMatch (2 players)', () => {
  it('builds a per-round breakdown ranking each player', () => {
    const summary = summarizeMatch(completedMatch(5000, 3000), ME);
    expect(summary.rounds).toHaveLength(2);

    const r1 = summary.rounds[0];
    expect(r1.label).toBe('Paris');
    const meR1 = r1.results.find((p) => p.isMe)!;
    const oppR1 = r1.results.find((p) => !p.isMe)!;
    expect(meR1.score).toBe(4000);
    expect(meR1.rank).toBe(1);
    expect(oppR1.rank).toBe(2);

    const r2 = summary.rounds[1];
    const oppR2 = r2.results.find((p) => !p.isMe)!;
    expect(oppR2.missed).toBe(true);
    expect(oppR2.distanceKm).toBeNull();
  });

  it('ranks the overall winner from the player totals', () => {
    let s = summarizeMatch(completedMatch(5000, 3000), ME);
    expect(s.me?.rank).toBe(1);
    expect(s.me?.isWinner).toBe(true);
    expect(s.isTie).toBe(false);

    s = summarizeMatch(completedMatch(2000, 9000), ME);
    expect(s.me?.rank).toBe(2);
    expect(s.me?.isWinner).toBe(false);

    s = summarizeMatch(completedMatch(4000, 4000), ME);
    expect(s.isTie).toBe(true);
    expect(s.winners).toHaveLength(2);
  });
});

describe('summarizeMatch (party of 8)', () => {
  it('produces a full 1..8 ranking with competition ties', () => {
    // Scores: 5000, 4000, 4000, 3000, 2000, 1000, 500, 0.
    const scores = [5000, 4000, 4000, 3000, 2000, 1000, 500, 0];
    const snap = makeSnapshot({
      room: makeRoom({ status: 'complete', maxPlayers: 8 }),
      players: party(8, scores),
    });
    const summary = summarizeMatch(snap, ME);

    expect(summary.standings).toHaveLength(8);
    // Winner is me (5000), rank 1, not tied.
    expect(summary.me?.rank).toBe(1);
    expect(summary.me?.isWinner).toBe(true);

    // The two 4000s share rank 2 (competition ranking: 1,2,2,4…).
    const at4000 = summary.standings.filter((s) => s.totalScore === 4000);
    expect(at4000).toHaveLength(2);
    expect(at4000.every((s) => s.rank === 2 && s.tied)).toBe(true);
    // Next distinct score (3000) is rank 4.
    expect(summary.standings.find((s) => s.totalScore === 3000)?.rank).toBe(4);
  });

  it('flags a tie at the top across multiple players', () => {
    const snap = makeSnapshot({
      room: makeRoom({ status: 'complete', maxPlayers: 3 }),
      players: party(3, [4200, 4200, 1000]),
    });
    const summary = summarizeMatch(snap, ME);
    expect(summary.isTie).toBe(true);
    expect(summary.winners).toHaveLength(2);
    expect(summary.winners.every((w) => w.rank === 1)).toBe(true);
  });
});

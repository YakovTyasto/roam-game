import { describe, it, expect } from 'vitest';
import { deriveRoomView } from './machine';
import {
  ME,
  OPP,
  makeGuess,
  makeRoom,
  makeRound,
  makeSnapshot,
  makeTarget,
  twoPlayers,
  makePlayer,
} from './__fixtures__/rooms';

describe('deriveRoomView', () => {
  it('is an error when the user is not a participant', () => {
    const snap = makeSnapshot({
      room: makeRoom({ status: 'active' }),
      players: [makePlayer({ userId: OPP, id: 'p-opp' })],
    });
    expect(deriveRoomView(snap, ME).status).toBe('error');
  });

  it('reports lobby with both-players gating', () => {
    const one = makeSnapshot({ players: [twoPlayers()[0]] });
    expect(deriveRoomView(one, ME).status).toBe('lobby');
    expect(deriveRoomView(one, ME).bothPlayersPresent).toBe(false);

    const two = makeSnapshot({ players: twoPlayers() });
    const view = deriveRoomView(two, ME);
    expect(view.status).toBe('lobby');
    expect(view.bothPlayersPresent).toBe(true);
    expect(view.isHost).toBe(true);
  });

  it('is an error (match ended) when the room is abandoned', () => {
    const snap = makeSnapshot({
      room: makeRoom({ status: 'abandoned' }),
      players: twoPlayers(),
    });
    const view = deriveRoomView(snap, ME);
    expect(view.status).toBe('error');
    expect(view.errorReason).toMatch(/left/i);
  });

  it('is active before I submit, and derives opponentSubmitted from the count', () => {
    const base = {
      room: makeRoom({ status: 'active', currentRound: 1 }),
      players: twoPlayers(),
    };
    // No one submitted yet.
    let view = deriveRoomView(
      makeSnapshot({ ...base, rounds: [makeRound({ submittedCount: 0 })] }),
      ME,
    );
    expect(view.status).toBe('active');
    expect(view.opponentSubmitted).toBe(false);

    // Opponent submitted (count 1, I have no guess) → opponentSubmitted true.
    view = deriveRoomView(
      makeSnapshot({ ...base, rounds: [makeRound({ submittedCount: 1 })] }),
      ME,
    );
    expect(view.status).toBe('active');
    expect(view.opponentSubmitted).toBe(true);
  });

  it('is submitted (guess locked) once I have a guess, opponent still hidden', () => {
    const view = deriveRoomView(
      makeSnapshot({
        room: makeRoom({ status: 'active', currentRound: 1 }),
        players: twoPlayers(),
        rounds: [makeRound({ submittedCount: 1 })],
        guesses: [makeGuess({ userId: ME, playerId: 'player-me' })],
      }),
      ME,
    );
    expect(view.status).toBe('submitted');
    expect(view.myGuess).not.toBeNull();
    // submittedCount 1 minus my own submission → opponent has NOT submitted.
    expect(view.opponentSubmitted).toBe(false);
    // Opponent guess is not revealed while the round is active.
    expect(view.opponentGuess).toBeNull();
  });

  it('reveals both guesses + target on a completed round', () => {
    const view = deriveRoomView(
      makeSnapshot({
        room: makeRoom({ status: 'active', currentRound: 1 }),
        players: twoPlayers(),
        rounds: [makeRound({ status: 'complete', submittedCount: 2 })],
        targets: [makeTarget()],
        guesses: [
          makeGuess({ id: 'g-me', userId: ME, playerId: 'player-me', score: 4761 }),
          makeGuess({ id: 'g-opp', userId: OPP, playerId: 'player-opp', score: 3000 }),
        ],
      }),
      ME,
    );
    expect(view.status).toBe('round-result');
    expect(view.currentTarget?.label).toBe('Paris');
    expect(view.myGuess?.score).toBe(4761);
    expect(view.opponentGuess?.score).toBe(3000);
  });

  it('is final when the room is complete', () => {
    const view = deriveRoomView(
      makeSnapshot({ room: makeRoom({ status: 'complete' }), players: twoPlayers() }),
      ME,
    );
    expect(view.status).toBe('final');
  });

  it('shows the active shell while the current round row is not yet visible', () => {
    const view = deriveRoomView(
      makeSnapshot({
        room: makeRoom({ status: 'active', currentRound: 2 }),
        players: twoPlayers(),
        rounds: [makeRound({ roundNumber: 1, status: 'complete' })],
      }),
      ME,
    );
    expect(view.status).toBe('active');
    expect(view.currentRound).toBeNull();
  });
});

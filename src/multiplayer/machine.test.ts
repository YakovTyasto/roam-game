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
  party,
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

  it('reports lobby with the 2+ start gate', () => {
    const one = makeSnapshot({ players: [twoPlayers()[0]] });
    expect(deriveRoomView(one, ME).status).toBe('lobby');
    expect(deriveRoomView(one, ME).canStart).toBe(false);

    const two = makeSnapshot({ players: twoPlayers() });
    const view = deriveRoomView(two, ME);
    expect(view.status).toBe('lobby');
    expect(view.canStart).toBe(true);
    expect(view.isHost).toBe(true);
  });

  it('supports a party of up to eight players in the lobby', () => {
    const snap = makeSnapshot({
      room: makeRoom({ maxPlayers: 8 }),
      players: party(8),
    });
    const view = deriveRoomView(snap, ME);
    expect(view.players).toHaveLength(8);
    expect(view.others).toHaveLength(7);
    expect(view.canStart).toBe(true);
  });

  it('is an error when the room is abandoned', () => {
    const snap = makeSnapshot({
      room: makeRoom({ status: 'abandoned' }),
      players: twoPlayers(),
    });
    expect(deriveRoomView(snap, ME).status).toBe('error');
  });

  it('is active before I submit; everyoneSubmitted tracks the eligible count', () => {
    const players = party(3);
    const base = {
      room: makeRoom({ status: 'active', currentRound: 1, maxPlayers: 4 }),
      players,
    };
    // No one submitted yet.
    let view = deriveRoomView(
      makeSnapshot({ ...base, rounds: [makeRound({ submittedCount: 0 })] }),
      ME,
    );
    expect(view.status).toBe('active');
    expect(view.eligibleCount).toBe(3);
    expect(view.everyoneSubmitted).toBe(false);

    // 2 of 3 submitted → still not everyone (dynamic threshold, not fixed 2).
    view = deriveRoomView(
      makeSnapshot({ ...base, rounds: [makeRound({ submittedCount: 2 })] }),
      ME,
    );
    expect(view.everyoneSubmitted).toBe(false);

    // All 3 submitted.
    view = deriveRoomView(
      makeSnapshot({ ...base, rounds: [makeRound({ submittedCount: 3 })] }),
      ME,
    );
    expect(view.everyoneSubmitted).toBe(true);
  });

  it('excludes departed players from the eligible count', () => {
    const players = party(3);
    players[2] = { ...players[2], connectionStatus: 'left' };
    const view = deriveRoomView(
      makeSnapshot({
        room: makeRoom({ status: 'active', currentRound: 1 }),
        players,
        rounds: [makeRound({ submittedCount: 2 })],
      }),
      ME,
    );
    // Only 2 eligible; both submitted → everyone submitted.
    expect(view.eligibleCount).toBe(2);
    expect(view.everyoneSubmitted).toBe(true);
  });

  it('is submitted (guess locked) once I have a guess', () => {
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
  });

  it('reveals all guesses + target on a completed round', () => {
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
    expect(view.roundGuesses).toHaveLength(2);
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

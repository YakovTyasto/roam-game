import type {
  MpGuess,
  MpPlayer,
  MpRound,
  MpTarget,
  MultiplayerStatus,
  RoomSnapshot,
} from './types';

/** The subset of MultiplayerStatus that describes being inside a room. */
export type RoomViewStatus = Extract<
  MultiplayerStatus,
  'lobby' | 'active' | 'submitted' | 'round-result' | 'final' | 'error'
>;

export interface RoomView {
  status: RoomViewStatus;
  /** Human-readable reason when status is 'error'. */
  errorReason: string | null;
  me: MpPlayer | null;
  opponent: MpPlayer | null;
  currentRound: MpRound | null;
  /** Revealed target for the current round (null until the round completes). */
  currentTarget: MpTarget | null;
  myGuess: MpGuess | null;
  /** Opponent's guess — only visible once the round is complete. */
  opponentGuess: MpGuess | null;
  /**
   * Whether the opponent has submitted this round. Derived from the round's
   * submitted_count and whether we ourselves have submitted, so it works even
   * while the opponent's actual guess row is still hidden by RLS.
   */
  opponentSubmitted: boolean;
  /** Whether exactly two players are present (start gate). */
  bothPlayersPresent: boolean;
  /** Whether this user is the host. */
  isHost: boolean;
}

/**
 * Derive the in-room view state purely from an authoritative snapshot plus the
 * current user id. This is the heart of the multiplayer state machine and is
 * fully unit-tested. The hook layers the transient, non-room states
 * (authenticating, reconnecting, menu, …) on top of this.
 */
export function deriveRoomView(snapshot: RoomSnapshot, userId: string): RoomView {
  const { room, players, rounds, targets, guesses } = snapshot;

  const me = players.find((p) => p.userId === userId) ?? null;
  const opponent = players.find((p) => p.userId !== userId) ?? null;
  const bothPlayersPresent = players.length === 2;
  const isHost = room.hostId === userId;

  const base = {
    me,
    opponent,
    bothPlayersPresent,
    isHost,
    currentRound: null as MpRound | null,
    currentTarget: null as MpTarget | null,
    myGuess: null as MpGuess | null,
    opponentGuess: null as MpGuess | null,
    opponentSubmitted: false,
  };

  // A snapshot that does not include us means we are no longer a participant
  // (removed, or never joined). Treat as a fatal room error.
  if (!me) {
    return { ...base, status: 'error', errorReason: 'You are no longer in this room.' };
  }

  if (room.status === 'abandoned') {
    return {
      ...base,
      status: 'error',
      errorReason: 'The match ended — a player left the room.',
    };
  }

  if (room.status === 'lobby') {
    return { ...base, status: 'lobby', errorReason: null };
  }

  if (room.status === 'complete') {
    return { ...base, status: 'final', errorReason: null };
  }

  // room.status === 'active'
  const currentRound =
    rounds.find((r) => r.roundNumber === room.currentRound) ?? null;

  if (!currentRound) {
    // Round row not visible yet (just started / RLS lag). Show the active shell;
    // the UI will render a loading state until the round appears.
    return { ...base, status: 'active', errorReason: null };
  }

  const currentTarget =
    targets.find((t) => t.roundId === currentRound.id) ?? null;
  const myGuess =
    guesses.find((g) => g.roundId === currentRound.id && g.userId === userId) ?? null;
  const opponentGuess =
    opponent != null
      ? guesses.find(
          (g) => g.roundId === currentRound.id && g.playerId === opponent.id,
        ) ?? null
      : null;

  const opponentSubmitted =
    currentRound.submittedCount - (myGuess ? 1 : 0) >= 1;

  const derived = {
    ...base,
    currentRound,
    currentTarget,
    myGuess,
    opponentGuess,
    opponentSubmitted,
  };

  if (currentRound.status === 'complete') {
    return { ...derived, status: 'round-result', errorReason: null };
  }

  // Round still in progress.
  if (myGuess) {
    return { ...derived, status: 'submitted', errorReason: null };
  }
  return { ...derived, status: 'active', errorReason: null };
}

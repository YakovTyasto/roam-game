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
  /** Every player in the room, ordered by slot (2–8 in a party room). */
  players: MpPlayer[];
  /** All players except me, slot-ordered. */
  others: MpPlayer[];
  currentRound: MpRound | null;
  /** Revealed target for the current round (null until the round completes). */
  currentTarget: MpTarget | null;
  myGuess: MpGuess | null;
  /**
   * Guesses for the current round that are visible to us: always my own, and
   * everyone's once the round is complete (RLS hides others' until then).
   */
  roundGuesses: MpGuess[];
  /** How many players have submitted this round (from the round row). */
  submittedCount: number;
  /** Players still eligible to submit (connection_status !== 'left'). */
  eligibleCount: number;
  /** True when every eligible player has submitted this round. */
  everyoneSubmitted: boolean;
  /** Whether at least the minimum (2) players are present — the start gate. */
  canStart: boolean;
  /** Whether this user is the host. */
  isHost: boolean;
}

function bySlot(a: MpPlayer, b: MpPlayer): number {
  return a.slot - b.slot;
}

/**
 * Derive the in-room view state purely from an authoritative snapshot plus the
 * current user id. This is the heart of the multiplayer state machine and is
 * fully unit-tested. The hook layers the transient, non-room states
 * (authenticating, reconnecting, menu, …) on top of this. Works for 2–8
 * players; round completion is driven by the eligible-player count, never a
 * fixed threshold.
 */
export function deriveRoomView(snapshot: RoomSnapshot, userId: string): RoomView {
  const { room, players: allPlayers, rounds, targets, guesses } = snapshot;

  const players = [...allPlayers].sort(bySlot);
  const me = players.find((p) => p.userId === userId) ?? null;
  const others = players.filter((p) => p.userId !== userId);
  const eligibleCount = players.filter((p) => p.connectionStatus !== 'left').length;
  const canStart = players.length >= 2;
  const isHost = room.hostId === userId;

  const base = {
    me,
    players,
    others,
    eligibleCount,
    canStart,
    isHost,
    currentRound: null as MpRound | null,
    currentTarget: null as MpTarget | null,
    myGuess: null as MpGuess | null,
    roundGuesses: [] as MpGuess[],
    submittedCount: 0,
    everyoneSubmitted: false,
  };

  // A snapshot that does not include us means we are no longer a participant.
  if (!me) {
    return { ...base, status: 'error', errorReason: 'You are no longer in this room.' };
  }

  if (room.status === 'abandoned') {
    return {
      ...base,
      status: 'error',
      errorReason: 'This room was closed.',
    };
  }

  if (room.status === 'lobby') {
    return { ...base, status: 'lobby', errorReason: null };
  }

  if (room.status === 'complete') {
    return { ...base, status: 'final', errorReason: null };
  }

  // room.status === 'active'
  const currentRound = rounds.find((r) => r.roundNumber === room.currentRound) ?? null;

  if (!currentRound) {
    // Round row not visible yet (just started / RLS lag). Show the active shell.
    return { ...base, status: 'active', errorReason: null };
  }

  const currentTarget = targets.find((t) => t.roundId === currentRound.id) ?? null;
  const roundGuesses = guesses.filter((g) => g.roundId === currentRound.id);
  const myGuess = roundGuesses.find((g) => g.userId === userId) ?? null;
  const submittedCount = currentRound.submittedCount;
  const everyoneSubmitted = eligibleCount > 0 && submittedCount >= eligibleCount;

  const derived = {
    ...base,
    currentRound,
    currentTarget,
    myGuess,
    roundGuesses,
    submittedCount,
    everyoneSubmitted,
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

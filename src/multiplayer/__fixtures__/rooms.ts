import type {
  MpGuess,
  MpPlayer,
  MpRound,
  MpTarget,
  MpRoom,
  RoomSnapshot,
} from '../types';

export const ME = 'user-me';
export const OPP = 'user-opp';

export function makeRoom(overrides: Partial<MpRoom> = {}): MpRoom {
  return {
    id: 'room-1',
    code: 'ABC234',
    hostId: ME,
    status: 'lobby',
    currentRound: 0,
    totalRounds: 5,
    roundDurationSeconds: 120,
    difficulty: 'normal',
    maxPlayers: 2,
    rematchRoomId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-01T06:00:00Z',
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<MpPlayer> = {}): MpPlayer {
  return {
    id: 'player-me',
    roomId: 'room-1',
    userId: ME,
    displayName: 'Me',
    slot: 1,
    totalScore: 0,
    connectionStatus: 'online',
    joinedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeRound(overrides: Partial<MpRound> = {}): MpRound {
  return {
    id: 'round-1',
    roomId: 'room-1',
    roundNumber: 1,
    panoId: 'pano-1',
    heading: 42,
    pitch: 0,
    zoom: 0,
    status: 'active',
    submittedCount: 0,
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: null,
    ...overrides,
  };
}

export function makeTarget(overrides: Partial<MpTarget> = {}): MpTarget {
  return {
    roundId: 'round-1',
    roomId: 'room-1',
    locationId: 'loc-1',
    lat: 48.8584,
    lng: 2.2945,
    label: 'Paris',
    country: 'France',
    ...overrides,
  };
}

export function makeGuess(overrides: Partial<MpGuess> = {}): MpGuess {
  return {
    id: 'guess-1',
    roundId: 'round-1',
    roomId: 'room-1',
    playerId: 'player-me',
    userId: ME,
    lat: 48,
    lng: 2,
    distanceKm: 97.8916,
    score: 4761,
    createdAt: '2026-01-01T00:00:10Z',
    ...overrides,
  };
}

export function makeSnapshot(partial: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    room: partial.room ?? makeRoom(),
    players: partial.players ?? [],
    rounds: partial.rounds ?? [],
    targets: partial.targets ?? [],
    guesses: partial.guesses ?? [],
    fetchedAt: partial.fetchedAt ?? 1000,
  };
}

/** Two players: me (slot 1, host) and opponent (slot 2). */
export function twoPlayers(
  meScore = 0,
  oppScore = 0,
): [MpPlayer, MpPlayer] {
  return [
    makePlayer({ id: 'player-me', userId: ME, slot: 1, totalScore: meScore }),
    makePlayer({
      id: 'player-opp',
      userId: OPP,
      slot: 2,
      displayName: 'Opp',
      totalScore: oppScore,
    }),
  ];
}

/**
 * A party of `count` players (2–8): me (slot 1, host) plus generated guests.
 * `scores[i]` sets each player's total score if provided.
 */
export function party(count: number, scores: number[] = []): MpPlayer[] {
  const players: MpPlayer[] = [];
  for (let i = 0; i < count; i++) {
    players.push(
      makePlayer({
        id: `player-${i + 1}`,
        userId: i === 0 ? ME : `user-${i + 1}`,
        displayName: i === 0 ? 'Me' : `Guest ${i + 1}`,
        slot: i + 1,
        totalScore: scores[i] ?? 0,
      }),
    );
  }
  return players;
}

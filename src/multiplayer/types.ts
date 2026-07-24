/**
 * Multiplayer domain types (app-facing, camelCase).
 *
 * These are the shapes the UI and hook work with. The API/repository layer
 * (`api.ts`) maps between the snake_case database rows and these types, so the
 * rest of the app never touches raw Supabase rows.
 */

/** Lifecycle of a room. Mirrors the DB `status` check constraint. */
export type RoomStatus = 'lobby' | 'active' | 'complete' | 'abandoned';

/** Lifecycle of a single round. Mirrors the DB `status` check constraint. */
export type RoundStatus = 'pending' | 'active' | 'complete';

/** A player's live connection state (driven by Realtime presence + leave). */
export type ConnectionStatus = 'online' | 'offline' | 'left';

/** Player slot within a room. Party rooms allow slots 1..8. */
export type PlayerSlot = number;

/** Minimum and maximum players a private room can hold. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export interface MpRoom {
  id: string;
  code: string;
  hostId: string;
  status: RoomStatus;
  currentRound: number;
  totalRounds: number;
  roundDurationSeconds: number;
  /** Chosen difficulty (locked at start). Old rooms default to 'normal'. */
  difficulty: import('../config/difficulty').Difficulty;
  /** Room capacity (2..8). Old rooms default to 2. */
  maxPlayers: number;
  rematchRoomId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface MpPlayer {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  slot: PlayerSlot;
  totalScore: number;
  connectionStatus: ConnectionStatus;
  joinedAt: string;
}

/**
 * Render/orientation data for a round. Deliberately does NOT contain the
 * target coordinates — those live in `MpTarget` and are only revealed by RLS
 * once the round is complete, so the answer cannot be read from the round row
 * while the round is being played.
 */
export interface MpRound {
  id: string;
  roomId: string;
  roundNumber: number;
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
  status: RoundStatus;
  /**
   * How many players have submitted a guess this round. Exposed on the round
   * row (readable while active) so a client can show "N of M submitted" WITHOUT
   * being able to read anyone's guess coordinates (those stay hidden by RLS
   * until the round is complete). Individual attribution is deliberately not
   * available before the reveal.
   */
  submittedCount: number;
  startedAt: string | null;
  endedAt: string | null;
}

/** The secret answer for a round. Only readable once the round is complete. */
export interface MpTarget {
  roundId: string;
  roomId: string;
  locationId: string;
  lat: number;
  lng: number;
  label: string;
  country: string;
}

export interface MpGuess {
  id: string;
  roundId: string;
  roomId: string;
  playerId: string;
  userId: string;
  lat: number;
  lng: number;
  distanceKm: number;
  score: number;
  createdAt: string;
}

/**
 * A full, authoritative snapshot of a room fetched from the database. The
 * client treats this as the source of truth and refetches it after every
 * relevant Realtime event (reconcile-on-event), which tolerates missed,
 * delayed, duplicated, or out-of-order events.
 */
export interface RoomSnapshot {
  room: MpRoom;
  players: MpPlayer[];
  rounds: MpRound[];
  targets: MpTarget[];
  guesses: MpGuess[];
  /** Client wall-clock time (ms) when this snapshot was fetched, for ordering. */
  fetchedAt: number;
}

/**
 * One round descriptor in the match manifest the host submits at start. The
 * host resolves a concrete Street View panorama id and a fixed heading so both
 * clients load the identical panorama and orientation. Field names are
 * snake_case because this object is passed straight to the SQL RPC as JSON.
 */
export interface ManifestRound {
  location_id: string;
  lat: number;
  lng: number;
  label: string;
  country: string;
  pano_id: string;
  heading: number;
  pitch: number;
  zoom: number;
}

/**
 * The explicit, finite set of multiplayer view states the UI can be in. This
 * is derived from the snapshot + a little local state (see `machine.ts`).
 */
export type MultiplayerStatus =
  | 'config-missing' // Supabase env vars absent
  | 'needs-maps-key' // Google Maps key absent (needed to render Street View)
  | 'authenticating' // establishing the anonymous session
  | 'menu' // choose create / join
  | 'creating' // creating a room
  | 'joining' // joining a room by code
  | 'lobby' // in a room, waiting for the match to start
  | 'active' // a round is in progress and this player has not submitted
  | 'submitted' // this player submitted; waiting for opponent / timeout
  | 'round-result' // round locked; both guesses + answer revealed
  | 'final' // match complete; totals + winner
  | 'reconnecting' // realtime dropped; refetching authoritative state
  | 'error'; // fatal room error (e.g. opponent left, room expired)

/** Winner of the match (or a completed round). */
export type Outcome = 'p1' | 'p2' | 'draw';

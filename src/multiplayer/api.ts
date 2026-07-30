import type { TypedSupabaseClient } from './supabaseClient';
import type { Difficulty } from '../config/difficulty';
import { toDifficulty } from '../config/difficulty';
import type { Database, Json } from './database.types';
import type {
  ManifestRound,
  MpGuess,
  MpPlayer,
  MpRound,
  MpTarget,
  MpRoom,
  PlayerSlot,
  RoomSnapshot,
  RoomStatus,
  RoundStatus,
  ConnectionStatus,
} from './types';

type RoomRow = Database['public']['Tables']['multiplayer_rooms']['Row'];
type PlayerRow = Database['public']['Tables']['multiplayer_players']['Row'];
type RoundRow = Database['public']['Tables']['multiplayer_rounds']['Row'];
type TargetRow = Database['public']['Tables']['multiplayer_round_targets']['Row'];
type GuessRow = Database['public']['Tables']['multiplayer_guesses']['Row'];

// ── Row → domain mappers ──────────────────────────────────────────────────

function mapRoom(r: RoomRow): MpRoom {
  return {
    id: r.id,
    code: r.code,
    hostId: r.host_id,
    status: r.status as RoomStatus,
    currentRound: r.current_round,
    totalRounds: r.total_rounds,
    roundDurationSeconds: r.round_duration_seconds,
    // Old rooms created before the v2 migration may lack these; default safely.
    difficulty: toDifficulty(r.difficulty),
    maxPlayers: r.max_players ?? 2,
    rematchRoomId: r.rematch_room_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
  };
}

function mapPlayer(r: PlayerRow): MpPlayer {
  return {
    id: r.id,
    roomId: r.room_id,
    userId: r.user_id,
    displayName: r.display_name,
    slot: r.slot as PlayerSlot,
    totalScore: r.total_score,
    connectionStatus: r.connection_status as ConnectionStatus,
    joinedAt: r.joined_at,
  };
}

function mapRound(r: RoundRow): MpRound {
  return {
    id: r.id,
    roomId: r.room_id,
    roundNumber: r.round_number,
    panoId: r.pano_id,
    heading: r.heading,
    pitch: r.pitch,
    zoom: r.zoom,
    status: r.status as RoundStatus,
    submittedCount: r.submitted_count,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

function mapTarget(r: TargetRow): MpTarget {
  return {
    roundId: r.round_id,
    roomId: r.room_id,
    locationId: r.location_id,
    lat: r.lat,
    lng: r.lng,
    label: r.label,
    country: r.country,
  };
}

function mapGuess(r: GuessRow): MpGuess {
  return {
    id: r.id,
    roundId: r.round_id,
    roomId: r.room_id,
    playerId: r.player_id,
    userId: r.user_id,
    lat: r.lat,
    lng: r.lng,
    distanceKm: r.distance_km,
    score: r.score,
    createdAt: r.created_at,
  };
}

// ── Errors ────────────────────────────────────────────────────────────────

/** Error thrown by API calls; message is safe to show to users. */
export class MultiplayerError extends Error {}

function fail(message: string): never {
  throw new MultiplayerError(message);
}

/**
 * The SQL RPCs RAISE EXCEPTION with already-friendly messages. Pass those
 * through; fall back to a generic message for unexpected/transport errors so we
 * never surface raw internals.
 */
function toUserMessage(error: { message?: string } | null): string {
  const raw = error?.message?.trim();
  if (raw && raw.length > 0 && raw.length < 200 && !/^permission denied/i.test(raw)) {
    return raw;
  }
  return 'Something went wrong talking to the server. Please try again.';
}

interface RoomRef {
  roomId: string;
  code: string;
}

function parseRoomRef(data: Json): RoomRef {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const roomId = data['room_id'];
    const code = data['code'];
    if (typeof roomId === 'string') {
      return { roomId, code: typeof code === 'string' ? code : '' };
    }
  }
  return fail('Unexpected response from the server.');
}

// ── Snapshot ──────────────────────────────────────────────────────────────

/**
 * Fetch the full authoritative snapshot of a room. RLS ensures the caller only
 * receives rows they are allowed to see (e.g. opponent guesses and round
 * targets appear only once a round is complete).
 */
export async function getSnapshot(
  supabase: TypedSupabaseClient,
  roomId: string,
): Promise<RoomSnapshot> {
  const fetchedAt = Date.now();
  const [roomRes, playersRes, roundsRes, targetsRes, guessesRes] = await Promise.all([
    supabase.from('multiplayer_rooms').select('*').eq('id', roomId).maybeSingle(),
    supabase.from('multiplayer_players').select('*').eq('room_id', roomId).order('slot'),
    supabase
      .from('multiplayer_rounds')
      .select('*')
      .eq('room_id', roomId)
      .order('round_number'),
    supabase.from('multiplayer_round_targets').select('*').eq('room_id', roomId),
    supabase.from('multiplayer_guesses').select('*').eq('room_id', roomId),
  ]);

  if (roomRes.error) fail(toUserMessage(roomRes.error));
  if (!roomRes.data) fail('This room is no longer available.');
  for (const res of [playersRes, roundsRes, targetsRes, guessesRes]) {
    if (res.error) fail(toUserMessage(res.error));
  }

  return {
    room: mapRoom(roomRes.data),
    players: (playersRes.data ?? []).map(mapPlayer),
    rounds: (roundsRes.data ?? []).map(mapRound),
    targets: (targetsRes.data ?? []).map(mapTarget),
    guesses: (guessesRes.data ?? []).map(mapGuess),
    fetchedAt,
  };
}

/** Measure the server clock (epoch ms) for skew-corrected countdowns. */
export async function serverNow(supabase: TypedSupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc('mp_server_now');
  if (error || typeof data !== 'string') {
    // Fall back to local time; the server still enforces expiry authoritatively.
    return Date.now();
  }
  const ms = Date.parse(data);
  return Number.isNaN(ms) ? Date.now() : ms;
}

// ── Mutations (all via transactional RPCs) ────────────────────────────────

export interface CreateRoomOptions {
  difficulty: Difficulty;
  maxPlayers: number;
  totalRounds?: number;
}

export async function createRoom(
  supabase: TypedSupabaseClient,
  name: string,
  options: CreateRoomOptions,
): Promise<RoomRef> {
  const { data, error } = await supabase.rpc('mp_create_room', {
    p_name: name,
    p_difficulty: options.difficulty,
    p_max_players: options.maxPlayers,
    p_total_rounds: options.totalRounds ?? 5,
  });
  if (error) fail(toUserMessage(error));
  return parseRoomRef(data);
}

export async function joinRoom(
  supabase: TypedSupabaseClient,
  code: string,
  name: string,
): Promise<RoomRef> {
  const { data, error } = await supabase.rpc('mp_join_room', {
    p_code: code,
    p_name: name,
  });
  if (error) fail(toUserMessage(error));
  return parseRoomRef(data);
}

/**
 * Start a match with a SERVER-selected manifest (migration 0015).
 *
 * The host sends nothing but the room id. The server picks the locations from
 * the protected catalog, applies room-wide novelty from every participant's
 * history, and stores the hidden targets — so a modified host client can no
 * longer choose easy locations, and cannot know an answer before its own guess.
 *
 * `startMatch` below is the pre-V5 path and is retained deliberately: the old
 * RPC is still granted for the rollout window, so reverting the client to it is
 * a working rollback if this path ever needs to be pulled. See
 * docs/ENGAGEMENT_CORE_V5.md.
 */
export async function startMatchServerSelected(
  supabase: TypedSupabaseClient,
  roomId: string,
): Promise<void> {
  const { error } = await supabase.rpc('mp_start_match_v2', { p_room_id: roomId });
  if (error) fail(toUserMessage(error));
}

/** @deprecated Pre-V5 client-manifest start. Kept as the documented rollback. */
export async function startMatch(
  supabase: TypedSupabaseClient,
  roomId: string,
  manifest: ManifestRound[],
): Promise<void> {
  const { error } = await supabase.rpc('mp_start_match', {
    p_room_id: roomId,
    p_manifest: manifest as unknown as Json,
  });
  if (error) fail(toUserMessage(error));
}

/**
 * Room-wide recent locations, for weighting host-side selection (migration
 * 0012). Anonymous by construction — see multiplayer/roomDiversity.ts.
 *
 * Never throws: a failure here must not be able to block a match start, so it
 * resolves to "not applied" and the host falls back to their own history.
 */
export async function getRoomRecentGroups(
  supabase: TypedSupabaseClient,
  roomId: string,
): Promise<unknown> {
  const { data, error } = await supabase.rpc('roam_room_recent_groups', { p_room_id: roomId });
  if (error) return null;
  return data;
}

export async function submitGuess(
  supabase: TypedSupabaseClient,
  roomId: string,
  lat: number,
  lng: number,
): Promise<void> {
  const { error } = await supabase.rpc('mp_submit_guess', {
    p_room_id: roomId,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) fail(toUserMessage(error));
}

export async function expireRound(
  supabase: TypedSupabaseClient,
  roomId: string,
): Promise<void> {
  const { error } = await supabase.rpc('mp_expire_round', { p_room_id: roomId });
  // Expiring "too early" is an expected race (server rejects it); swallow so the
  // client can simply retry on the next tick.
  if (error && !/not.*expired|too early|not.*over/i.test(error.message ?? '')) {
    fail(toUserMessage(error));
  }
}

export async function advanceRound(
  supabase: TypedSupabaseClient,
  roomId: string,
  fromRound: number,
): Promise<void> {
  const { error } = await supabase.rpc('mp_advance_round', {
    p_room_id: roomId,
    p_from_round: fromRound,
  });
  if (error) fail(toUserMessage(error));
}

export async function leaveRoom(
  supabase: TypedSupabaseClient,
  roomId: string,
): Promise<void> {
  const { error } = await supabase.rpc('mp_leave_room', { p_room_id: roomId });
  if (error) fail(toUserMessage(error));
}

export async function createRematch(
  supabase: TypedSupabaseClient,
  roomId: string,
): Promise<RoomRef> {
  const { data, error } = await supabase.rpc('mp_create_rematch', {
    p_room_id: roomId,
  });
  if (error) fail(toUserMessage(error));
  return parseRoomRef(data);
}

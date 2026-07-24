/**
 * Hand-written Supabase schema types for the multiplayer tables and RPCs.
 *
 * Mirrors supabase/migrations. Kept intentionally close to the shape produced
 * by `supabase gen types typescript` so it can be regenerated later. Client
 * code never writes to these tables directly (all mutations go through RPCs),
 * so the `Insert`/`Update` shapes are permissive.
 *
 * NOTE: row shapes are `type` aliases (not `interface`) on purpose — supabase's
 * generic schema constraints require rows to be assignable to
 * `Record<string, unknown>`, which interfaces are not.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type RoomRow = {
  id: string;
  code: string;
  host_id: string;
  status: string;
  current_round: number;
  total_rounds: number;
  round_duration_seconds: number;
  difficulty: string;
  max_players: number;
  rematch_room_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type ProfileRow = {
  user_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

type PlayerRow = {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  slot: number;
  total_score: number;
  connection_status: string;
  joined_at: string;
};

type RoundRow = {
  id: string;
  room_id: string;
  round_number: number;
  pano_id: string;
  heading: number;
  pitch: number;
  zoom: number;
  status: string;
  submitted_count: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

type TargetRow = {
  round_id: string;
  room_id: string;
  location_id: string;
  lat: number;
  lng: number;
  label: string;
  country: string;
};

type GuessRow = {
  id: string;
  round_id: string;
  room_id: string;
  player_id: string;
  user_id: string;
  lat: number;
  lng: number;
  distance_km: number;
  score: number;
  created_at: string;
};

type ReadOnlyTable<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      multiplayer_rooms: ReadOnlyTable<RoomRow>;
      multiplayer_players: ReadOnlyTable<PlayerRow>;
      multiplayer_rounds: ReadOnlyTable<RoundRow>;
      multiplayer_round_targets: ReadOnlyTable<TargetRow>;
      multiplayer_guesses: ReadOnlyTable<GuessRow>;
      player_profiles: ReadOnlyTable<ProfileRow>;
    };
    Views: Record<string, never>;
    Functions: {
      mp_server_now: { Args: Record<PropertyKey, never>; Returns: string };
      mp_create_room: {
        Args: {
          p_name: string;
          p_difficulty?: string;
          p_max_players?: number;
          p_total_rounds?: number;
          p_round_duration?: number;
        };
        Returns: Json;
      };
      mp_join_room: { Args: { p_code: string; p_name: string }; Returns: Json };
      mp_start_match: { Args: { p_room_id: string; p_manifest: Json }; Returns: Json };
      mp_submit_guess: {
        Args: { p_room_id: string; p_lat: number; p_lng: number };
        Returns: Json;
      };
      mp_expire_round: { Args: { p_room_id: string }; Returns: Json };
      mp_advance_round: { Args: { p_room_id: string; p_from_round: number }; Returns: Json };
      mp_leave_room: { Args: { p_room_id: string }; Returns: Json };
      mp_create_rematch: { Args: { p_room_id: string }; Returns: Json };
      roam_upsert_profile: { Args: { p_name: string }; Returns: Json };
      roam_get_profile: { Args: Record<PropertyKey, never>; Returns: Json };
      roam_create_solo_run: {
        Args: { p_difficulty: string; p_total_rounds: number; p_manifest: Json };
        Returns: Json;
      };
      roam_submit_solo_guess: {
        Args: { p_run_id: string; p_round_number: number; p_lat: number; p_lng: number };
        Returns: Json;
      };
      roam_finalize_solo_run: { Args: { p_run_id: string }; Returns: Json };
      roam_get_active_solo_run: { Args: Record<PropertyKey, never>; Returns: Json };
      roam_leaderboard: {
        Args: {
          p_mode: string;
          p_difficulty: string;
          p_limit?: number;
          p_at?: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

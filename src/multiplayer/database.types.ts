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
      roam_set_preferences: {
        Args: { p_theme: string | null; p_locale: string | null };
        Returns: Json;
      };
      roam_create_solo_run: {
        Args: {
          p_difficulty: string;
          p_total_rounds: number;
          p_manifest: Json;
          p_timer_seconds: number | null;
        };
        Returns: Json;
      };
      roam_submit_solo_guess: {
        Args: { p_run_id: string; p_round_number: number; p_lat: number; p_lng: number };
        Returns: Json;
      };
      roam_finalize_solo_run: { Args: { p_run_id: string }; Returns: Json };
      roam_abandon_solo_run: { Args: { p_run_id: string }; Returns: Json };
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
      // ── Diversity Engine V2: durable location history (migration 0011) ──
      roam_record_location_history: {
        Args: {
          p_group_ids: string[];
          p_difficulty?: string;
          p_collection?: string;
          p_mode?: string;
        };
        Returns: Json;
      };
      roam_get_location_history: { Args: { p_limit?: number | null }; Returns: Json };
      roam_reset_location_history: { Args: Record<PropertyKey, never>; Returns: Json };
      // ── Room-wide novelty for host-side selection (migration 0012) ──────
      roam_room_recent_groups: { Args: { p_room_id: string }; Returns: Json };
      // ── Server-authoritative catalog + official runs (0013-0015) ─────────
      // The `_v2` names are deliberate: the legacy manifest RPCs above stay in
      // place for the duration of the rollout so an older deployed client keeps
      // working. See docs/ENGAGEMENT_CORE_V5.md.
      roam_catalog_summary: { Args: Record<PropertyKey, never>; Returns: Json };
      roam_start_official_run_v2: {
        Args: {
          p_difficulty: string;
          p_total_rounds?: number;
          p_timer_seconds?: number | null;
        };
        Returns: Json;
      };
      roam_get_official_run_v2: { Args: { p_run_id?: string | null }; Returns: Json };
      roam_submit_official_guess_v2: {
        Args: { p_run_id: string; p_round_number: number; p_lat: number; p_lng: number };
        Returns: Json;
      };
      roam_finalize_official_run_v2: { Args: { p_run_id: string }; Returns: Json };
      mp_start_match_v2: { Args: { p_room_id: string }; Returns: Json };
      // ── Daily Challenge (migration 0016) ─────────────────────────────────
      roam_utc_day: { Args: { p_at?: string }; Returns: string };
      roam_daily_status: { Args: Record<PropertyKey, never>; Returns: Json };
      roam_start_daily_v2: { Args: { p_practice?: boolean }; Returns: Json };
      roam_daily_leaderboard: {
        Args: { p_day?: string | null; p_limit?: number };
        Returns: Json;
      };
      // ── Shared challenges (migration 0017) ───────────────────────────────
      roam_create_challenge_v2: {
        Args: {
          p_difficulty?: string;
          p_round_count?: number;
          p_timer_seconds?: number | null;
          p_title?: string;
          p_expires_hours?: number;
        };
        Returns: Json;
      };
      roam_get_challenge_v2: { Args: { p_code: string }; Returns: Json };
      roam_start_challenge_v2: { Args: { p_code: string }; Returns: Json };
      roam_challenge_leaderboard: {
        Args: { p_code: string; p_limit?: number };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

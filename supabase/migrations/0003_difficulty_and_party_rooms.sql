-- ============================================================================
-- Roam v2 — Difficulty levels + private party rooms (2–8 players).
--
-- INCREMENTAL migration. It NEVER edits 0001/0002; it only ALTERs the existing
-- schema and CREATE OR REPLACEs / DROPs-and-recreates the RPCs whose 2-player
-- assumptions must change. Safe to run on a production database upgraded from
-- 0001+0002, and also as part of a clean run of 0001→0005 in sequence.
--
-- What changes here:
--   • rooms gain `difficulty` and `max_players` (old rooms default to
--     difficulty='normal', max_players=2 — the pre-v2 behaviour).
--   • player `slot` widens from {1,2} to 1..8.
--   • the round `submitted_count <= 2` assumption is removed.
--   • round completion becomes DYNAMIC: a round completes when every eligible
--     (non-departed) player has submitted, or the server timer expires.
--   • leave/host logic is redesigned so one player leaving a party does not
--     destroy the room; host status transfers to the earliest active player.
--   • the old `mp_create_room(text,int,int)` signature is DROPPED and replaced
--     with a difficulty/capacity-aware one, so no obsolete overload can bypass
--     the new rules.
-- ============================================================================

-- ── Schema changes ──────────────────────────────────────────────────────────

alter table public.multiplayer_rooms
  add column if not exists difficulty text not null default 'normal';

alter table public.multiplayer_rooms
  drop constraint if exists mp_rooms_difficulty_check;
alter table public.multiplayer_rooms
  add constraint mp_rooms_difficulty_check
  check (difficulty in ('easy', 'normal', 'hard'));

alter table public.multiplayer_rooms
  add column if not exists max_players int not null default 2;

alter table public.multiplayer_rooms
  drop constraint if exists mp_rooms_max_players_check;
alter table public.multiplayer_rooms
  add constraint mp_rooms_max_players_check
  check (max_players between 2 and 8);

-- Widen the player slot range 1..2 → 1..8. The inline check from 0001 is named
-- `multiplayer_players_slot_check` by Postgres; drop it (if present) and add a
-- named replacement so this is idempotent.
alter table public.multiplayer_players
  drop constraint if exists multiplayer_players_slot_check;
alter table public.multiplayer_players
  drop constraint if exists mp_players_slot_range;
alter table public.multiplayer_players
  add constraint mp_players_slot_range check (slot between 1 and 8);

-- Remove the 2-player cap on submitted_count; keep it non-negative.
alter table public.multiplayer_rounds
  drop constraint if exists multiplayer_rounds_submitted_count_check;
alter table public.multiplayer_rounds
  drop constraint if exists mp_rounds_submitted_count_check;
alter table public.multiplayer_rounds
  add constraint mp_rounds_submitted_count_check check (submitted_count >= 0);

-- Helpful index for the frequent "eligible players in a room" count.
create index if not exists idx_mp_players_room_conn
  on public.multiplayer_players (room_id, connection_status);

-- ── Difficulty → default round duration (shared with the client presets) ────
-- Mirrors src/config/difficulty.ts. Used when a room is created so the timer
-- matches the chosen difficulty unless an explicit override is supplied.

create or replace function public.mp_difficulty_duration(p_difficulty text)
returns int
language sql
immutable
set search_path = pg_temp
as $$
  select case p_difficulty
    when 'easy' then 180
    when 'hard' then 75
    else 120
  end;
$$;

-- ── Eligible-player + host helpers ──────────────────────────────────────────

-- Count players still eligible to submit this match (everyone who has not
-- explicitly left). Departed players never block round completion.
create or replace function public.mp_eligible_count(p_room_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.multiplayer_players
  where room_id = p_room_id
    and connection_status <> 'left';
$$;

-- Transfer host to the earliest remaining active player, or abandon the room if
-- nobody active is left. Called after a host leaves. Never trusts the caller —
-- `p_room_id` is already locked by the caller.
create or replace function public.mp_reassign_host(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_host uuid;
begin
  select user_id into v_new_host
  from public.multiplayer_players
  where room_id = p_room_id
    and connection_status <> 'left'
  order by slot, joined_at
  limit 1;

  if v_new_host is null then
    update public.multiplayer_rooms
      set status = 'abandoned', updated_at = now()
      where id = p_room_id and status in ('lobby', 'active');
  else
    update public.multiplayer_rooms
      set host_id = v_new_host, updated_at = now()
      where id = p_room_id;
  end if;
end;
$$;

-- Complete the current active round if every eligible player has now submitted.
-- Dynamic threshold — NEVER a hard-coded 2. Idempotent via mp_complete_round.
create or replace function public.mp_maybe_complete_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.multiplayer_rooms;
  v_round public.multiplayer_rounds;
  v_submitted int;
  v_eligible int;
begin
  select * into v_room from public.multiplayer_rooms where id = p_room_id;
  if not found or v_room.status <> 'active' then
    return;
  end if;

  select * into v_round from public.multiplayer_rounds
    where room_id = p_room_id and round_number = v_room.current_round;
  if not found or v_round.status <> 'active' then
    return;
  end if;

  select count(*) into v_submitted from public.multiplayer_guesses
    where round_id = v_round.id;
  v_eligible := public.mp_eligible_count(p_room_id);

  -- Complete when all eligible players have guessed. Guard eligible > 0 so an
  -- all-left room does not "complete" with zero players (it is abandoned
  -- elsewhere instead).
  if v_eligible > 0 and v_submitted >= v_eligible then
    perform public.mp_complete_round(v_round.id);
  end if;
end;
$$;

-- ── Create room (difficulty + capacity aware) ───────────────────────────────
-- The old mp_create_room(text,int,int) is dropped so no caller can create a
-- room that bypasses difficulty/capacity. New signature keeps sensible
-- defaults (normal difficulty, 2 players) for backward-compatible callers.

drop function if exists public.mp_create_room(text, int, int);

create or replace function public.mp_create_room(
  p_name text,
  p_difficulty text default 'normal',
  p_max_players int default 2,
  p_total_rounds int default 5,
  p_round_duration int default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_code text;
  v_room public.multiplayer_rooms;
  v_attempts int := 0;
  v_duration int;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a room.';
  end if;

  v_name := public.mp_clean_name(p_name);
  if char_length(v_name) < 1 then
    raise exception 'Enter a display name.';
  end if;
  if p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Invalid difficulty.';
  end if;
  if p_max_players < 2 or p_max_players > 8 then
    raise exception 'Player capacity must be between 2 and 8.';
  end if;
  if p_total_rounds < 1 or p_total_rounds > 10 then
    raise exception 'Invalid round count.';
  end if;

  v_duration := coalesce(p_round_duration, public.mp_difficulty_duration(p_difficulty));
  if v_duration < 15 or v_duration > 600 then
    raise exception 'Invalid round duration.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := public.mp_gen_code();
    begin
      insert into public.multiplayer_rooms
        (code, host_id, total_rounds, round_duration_seconds, difficulty, max_players)
      values
        (v_code, v_uid, p_total_rounds, v_duration, p_difficulty, p_max_players)
      returning * into v_room;
      exit;
    exception when unique_violation then
      if v_attempts >= 10 then
        raise exception 'Could not allocate a room code. Please try again.';
      end if;
    end;
  end loop;

  insert into public.multiplayer_players (room_id, user_id, display_name, slot)
  values (v_room.id, v_uid, v_name, 1);

  return json_build_object('room_id', v_room.id, 'code', v_room.code);
end;
$$;

-- ── Join room (capacity-aware, lowest free slot) ────────────────────────────

create or replace function public.mp_join_room(p_code text, p_name text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_room public.multiplayer_rooms;
  v_existing public.multiplayer_players;
  v_count int;
  v_slot smallint;
begin
  if v_uid is null then
    raise exception 'You must be signed in to join a room.';
  end if;

  select * into v_room from public.multiplayer_rooms
    where code = v_code
    for update;
  if not found then
    raise exception 'Room not found. Check the code and try again.';
  end if;

  -- Idempotent rejoin: already a participant (reconnect / multiple tabs). Also
  -- restores a player who had gone 'offline' back to 'online'.
  select * into v_existing from public.multiplayer_players
    where room_id = v_room.id and user_id = v_uid;
  if found then
    if v_existing.connection_status = 'offline' then
      update public.multiplayer_players set connection_status = 'online'
        where id = v_existing.id;
    end if;
    return json_build_object('room_id', v_room.id, 'code', v_room.code);
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'This match has already started.';
  end if;
  if v_room.expires_at < now() then
    raise exception 'This room has expired. Ask the host to create a new one.';
  end if;

  v_name := public.mp_clean_name(p_name);
  if char_length(v_name) < 1 then
    raise exception 'Enter a display name.';
  end if;

  select count(*) into v_count from public.multiplayer_players
    where room_id = v_room.id;
  if v_count >= v_room.max_players then
    raise exception 'This room is full.';
  end if;

  -- Lowest free slot in 1..max_players.
  select min(s) into v_slot
  from generate_series(1, v_room.max_players) as s
  where not exists (
    select 1 from public.multiplayer_players
    where room_id = v_room.id and slot = s
  );
  if v_slot is null then
    raise exception 'This room is full.';
  end if;

  insert into public.multiplayer_players (room_id, user_id, display_name, slot)
  values (v_room.id, v_uid, v_name, v_slot);

  return json_build_object('room_id', v_room.id, 'code', v_room.code);
end;
$$;

-- ── Start match (host only; needs 2+ players, not necessarily full) ─────────

create or replace function public.mp_start_match(p_room_id uuid, p_manifest jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.multiplayer_rooms;
  v_count int;
  v_len int;
  v_elem jsonb;
  v_lat double precision;
  v_lng double precision;
  v_round_id uuid;
  v_seen text[] := array[]::text[];
  i int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_room from public.multiplayer_rooms
    where id = p_room_id
    for update;
  if not found then
    raise exception 'Room not found.';
  end if;
  if v_room.host_id <> v_uid then
    raise exception 'Only the host can start the match.';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'This match has already started.';
  end if;

  select count(*) into v_count from public.multiplayer_players
    where room_id = p_room_id;
  if v_count < 2 then
    raise exception 'You need at least two players to start.';
  end if;

  if p_manifest is null or jsonb_typeof(p_manifest) <> 'array' then
    raise exception 'Invalid match manifest.';
  end if;
  v_len := jsonb_array_length(p_manifest);
  if v_len <> v_room.total_rounds then
    raise exception 'Manifest must contain exactly % rounds.', v_room.total_rounds;
  end if;

  for i in 0 .. v_len - 1 loop
    v_elem := p_manifest -> i;
    if v_elem is null or jsonb_typeof(v_elem) <> 'object' then
      raise exception 'Malformed round in manifest.';
    end if;

    v_lat := (v_elem ->> 'lat')::double precision;
    v_lng := (v_elem ->> 'lng')::double precision;
    if v_lat is null or v_lat < -90 or v_lat > 90 then
      raise exception 'Invalid latitude in manifest.';
    end if;
    if v_lng is null or v_lng < -180 or v_lng > 180 then
      raise exception 'Invalid longitude in manifest.';
    end if;
    if coalesce(v_elem ->> 'pano_id', '') = '' then
      raise exception 'Missing panorama data in manifest.';
    end if;
    if coalesce(v_elem ->> 'location_id', '') = '' then
      raise exception 'Missing location id in manifest.';
    end if;
    if coalesce(v_elem ->> 'label', '') = ''
       or coalesce(v_elem ->> 'country', '') = '' then
      raise exception 'Missing label/country in manifest.';
    end if;
    if (v_elem ->> 'location_id') = any (v_seen) then
      raise exception 'Manifest contains a duplicate location.';
    end if;
    v_seen := array_append(v_seen, v_elem ->> 'location_id');

    insert into public.multiplayer_rounds
      (room_id, round_number, pano_id, heading, pitch, zoom, status, started_at)
    values (
      p_room_id,
      i + 1,
      v_elem ->> 'pano_id',
      coalesce((v_elem ->> 'heading')::double precision, 0),
      coalesce((v_elem ->> 'pitch')::double precision, 0),
      coalesce((v_elem ->> 'zoom')::double precision, 0),
      case when i = 0 then 'active' else 'pending' end,
      case when i = 0 then now() else null end
    )
    returning id into v_round_id;

    insert into public.multiplayer_round_targets
      (round_id, room_id, location_id, lat, lng, label, country)
    values (
      v_round_id, p_room_id, v_elem ->> 'location_id',
      v_lat, v_lng, v_elem ->> 'label', v_elem ->> 'country'
    );
  end loop;

  update public.multiplayer_rooms
    set status = 'active', current_round = 1, updated_at = now()
    where id = p_room_id;

  return json_build_object('room_id', p_room_id, 'code', v_room.code);
end;
$$;

-- ── Submit guess (idempotent, server-scored, dynamic completion) ────────────

create or replace function public.mp_submit_guess(
  p_room_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.multiplayer_rooms;
  v_player public.multiplayer_players;
  v_round public.multiplayer_rounds;
  v_target public.multiplayer_round_targets;
  v_dist double precision;
  v_score int;
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid guess coordinates.';
  end if;

  select * into v_room from public.multiplayer_rooms
    where id = p_room_id
    for update;
  if not found then
    raise exception 'Room not found.';
  end if;
  if v_room.status <> 'active' then
    raise exception 'The match is not active.';
  end if;

  select * into v_player from public.multiplayer_players
    where room_id = p_room_id and user_id = v_uid;
  if not found then
    raise exception 'You are not in this room.';
  end if;
  if v_player.connection_status = 'left' then
    raise exception 'You have left this match.';
  end if;

  select * into v_round from public.multiplayer_rounds
    where room_id = p_room_id and round_number = v_room.current_round
    for update;
  if not found then
    raise exception 'There is no active round.';
  end if;
  if v_round.status <> 'active' then
    return json_build_object('ok', true); -- already locked; nothing to do
  end if;

  -- Late submit after the server-authoritative deadline → lock the round.
  if v_round.started_at is not null
     and now() >= v_round.started_at
         + make_interval(secs => v_room.round_duration_seconds) then
    perform public.mp_complete_round(v_round.id);
    return json_build_object('ok', true, 'expired', true);
  end if;

  select * into v_target from public.multiplayer_round_targets
    where round_id = v_round.id;
  if not found then
    raise exception 'Round data is missing.';
  end if;

  v_dist := public.mp_haversine_km(p_lat, p_lng, v_target.lat, v_target.lng);
  v_score := public.mp_score(v_dist);

  insert into public.multiplayer_guesses
    (round_id, room_id, player_id, user_id, lat, lng, distance_km, score)
  values
    (v_round.id, p_room_id, v_player.id, v_uid, p_lat, p_lng, v_dist, v_score)
  on conflict (round_id, player_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.multiplayer_rounds
      set submitted_count = submitted_count + 1
      where id = v_round.id;
  end if;

  -- Dynamic completion: complete once every eligible player has submitted.
  perform public.mp_maybe_complete_round(p_room_id);

  return json_build_object('ok', true);
end;
$$;

-- ── Leave room (party-aware: one leave never destroys a full party) ─────────

create or replace function public.mp_leave_room(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.multiplayer_rooms;
  v_player public.multiplayer_players;
  v_remaining int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_room from public.multiplayer_rooms
    where id = p_room_id
    for update;
  if not found then
    return json_build_object('ok', true);
  end if;

  select * into v_player from public.multiplayer_players
    where room_id = p_room_id and user_id = v_uid;
  if not found then
    return json_build_object('ok', true);
  end if;

  if v_room.status = 'lobby' then
    -- Free the slot entirely; a lobby departure leaves no trace.
    delete from public.multiplayer_players where id = v_player.id;
    select count(*) into v_remaining from public.multiplayer_players
      where room_id = p_room_id;
    if v_remaining = 0 then
      update public.multiplayer_rooms
        set status = 'abandoned', updated_at = now()
        where id = p_room_id;
    elsif v_room.host_id = v_uid then
      perform public.mp_reassign_host(p_room_id);
    end if;

  elsif v_room.status = 'active' then
    -- Keep the row (needed for scoring/slots) but mark the player departed.
    update public.multiplayer_players
      set connection_status = 'left'
      where id = v_player.id;

    if v_room.host_id = v_uid then
      perform public.mp_reassign_host(p_room_id);
    end if;

    -- If everyone still eligible has already guessed, complete the round now so
    -- the departure does not stall the remaining players. If nobody eligible is
    -- left, abandon the match.
    if public.mp_eligible_count(p_room_id) = 0 then
      update public.multiplayer_rooms
        set status = 'abandoned', updated_at = now()
        where id = p_room_id and status = 'active';
    else
      perform public.mp_maybe_complete_round(p_room_id);
    end if;
  end if;

  return json_build_object('ok', true);
end;
$$;

-- ── Rematch (copies eligible, non-left players; preserves difficulty/cap) ────

create or replace function public.mp_create_rematch(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.multiplayer_rooms;
  v_new_id uuid;
  v_code text;
  v_attempts int := 0;
  v_new_host uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_room from public.multiplayer_rooms
    where id = p_room_id
    for update;
  if not found then
    raise exception 'Room not found.';
  end if;
  if not public.mp_is_participant(p_room_id) then
    raise exception 'You are not in this room.';
  end if;
  if v_room.status <> 'complete' then
    raise exception 'You can only rematch after the game ends.';
  end if;

  -- Idempotent: everyone joins the same rematch room.
  if v_room.rematch_room_id is not null then
    select code into v_code from public.multiplayer_rooms
      where id = v_room.rematch_room_id;
    return json_build_object('room_id', v_room.rematch_room_id, 'code', v_code);
  end if;

  -- Host of the rematch: the original host if still eligible, else the earliest
  -- remaining eligible player.
  select user_id into v_new_host from public.multiplayer_players
    where room_id = p_room_id and user_id = v_room.host_id
      and connection_status <> 'left';
  if v_new_host is null then
    select user_id into v_new_host from public.multiplayer_players
      where room_id = p_room_id and connection_status <> 'left'
      order by slot, joined_at
      limit 1;
  end if;
  if v_new_host is null then
    raise exception 'No eligible players remain for a rematch.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := public.mp_gen_code();
    begin
      insert into public.multiplayer_rooms
        (code, host_id, total_rounds, round_duration_seconds, difficulty, max_players)
      values
        (v_code, v_new_host, v_room.total_rounds, v_room.round_duration_seconds,
         v_room.difficulty, v_room.max_players)
      returning id into v_new_id;
      exit;
    exception when unique_violation then
      if v_attempts >= 10 then
        raise exception 'Could not allocate a room code. Please try again.';
      end if;
    end;
  end loop;

  -- Copy eligible (non-left) players into fresh slots 1..n, scores reset to 0.
  insert into public.multiplayer_players
    (room_id, user_id, display_name, slot, total_score)
  select v_new_id, user_id, display_name,
         row_number() over (order by slot, joined_at)::smallint, 0
  from public.multiplayer_players
  where room_id = p_room_id and connection_status <> 'left';

  update public.multiplayer_rooms
    set rematch_room_id = v_new_id, updated_at = now()
    where id = p_room_id;

  return json_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;

-- ── Function privileges (new/replaced signatures) ───────────────────────────

revoke all on function public.mp_difficulty_duration(text) from public;
revoke all on function public.mp_eligible_count(uuid) from public;
revoke all on function public.mp_reassign_host(uuid) from public;
revoke all on function public.mp_maybe_complete_round(uuid) from public;
revoke all on function public.mp_create_room(text, text, int, int, int) from public;
revoke all on function public.mp_join_room(text, text) from public;
revoke all on function public.mp_start_match(uuid, jsonb) from public;
revoke all on function public.mp_submit_guess(uuid, double precision, double precision) from public;
revoke all on function public.mp_leave_room(uuid) from public;
revoke all on function public.mp_create_rematch(uuid) from public;

-- Internal helpers stay server-only; only the create-room RPC is client-callable.
grant execute on function public.mp_create_room(text, text, int, int, int) to authenticated;
grant execute on function public.mp_join_room(text, text) to authenticated;
grant execute on function public.mp_start_match(uuid, jsonb) to authenticated;
grant execute on function public.mp_submit_guess(uuid, double precision, double precision) to authenticated;
grant execute on function public.mp_leave_room(uuid) to authenticated;
grant execute on function public.mp_create_rematch(uuid) to authenticated;

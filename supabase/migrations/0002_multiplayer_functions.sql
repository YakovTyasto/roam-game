-- ============================================================================
-- Roam — Private multiplayer: scoring + transactional RPCs.
--
-- Every sensitive action is a SECURITY DEFINER function with an explicit, safe
-- search_path. Identity comes from auth.uid(); scores are computed on the
-- trusted server side; state transitions and host-only actions are validated;
-- timer decisions use server time. Actions are idempotent where it matters.
--
-- Scoring MUST match the solo game exactly (src/utils/distance.ts + score.ts):
--   distance = Haversine, Earth radius 6371 km
--   score    = round(5000 * exp(-distanceKm / 2000)), clamped to [0, 5000]
-- Shared test vectors live in src/multiplayer/__fixtures__/scoreVectors.ts and
-- are checked against the SQL functions in docs/MULTIPLAYER_SETUP.md.
-- ============================================================================

-- ── Scoring / distance (parity with the TypeScript utils) ───────────────────

create or replace function public.mp_haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns double precision
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  d_lat double precision := radians(lat2 - lat1);
  d_lng double precision := radians(lng2 - lng1);
  sin_lat double precision := sin(d_lat / 2);
  sin_lng double precision := sin(d_lng / 2);
  a double precision;
  c double precision;
begin
  a := sin_lat * sin_lat
       + cos(radians(lat1)) * cos(radians(lat2)) * sin_lng * sin_lng;
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  return 6371.0 * c;
end;
$$;

create or replace function public.mp_score(distance_km double precision)
returns int
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  max_score constant int := 5000;
  falloff constant double precision := 2000;
  raw double precision;
begin
  -- Guard NaN (v <> v), negatives, infinity — mirrors the TS !isFinite check.
  if distance_km is null
     or distance_km <> distance_km
     or distance_km < 0
     or distance_km = 'infinity'::double precision then
    return 0;
  end if;
  raw := max_score * exp(-distance_km / falloff);
  -- round() on numeric rounds halves away from zero; raw >= 0 so this matches
  -- JavaScript's Math.round for the whole non-negative range.
  return greatest(0, least(max_score, round(raw::numeric)::int));
end;
$$;

-- ── Small internal helpers ──────────────────────────────────────────────────

-- Unambiguous 6-char code (excludes 0/O/1/I/L). Must match ROOM_CODE_ALPHABET
-- in src/multiplayer/roomCode.ts.
create or replace function public.mp_gen_code()
returns text
language plpgsql
volatile
set search_path = pg_temp
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := '';
  i int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- Trim, strip control chars + angle brackets, collapse whitespace, clamp to 24.
create or replace function public.mp_clean_name(p_name text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select left(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g'),
        '\s+', ' ', 'g'
      )
    ),
    24
  );
$$;

-- Complete a round exactly once (idempotent), revealing it and adding each
-- player's round score (0 if they never guessed) to their total.
create or replace function public.mp_complete_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round public.multiplayer_rounds;
  v_player record;
begin
  select * into v_round from public.multiplayer_rounds
    where id = p_round_id
    for update;
  if not found then
    return;
  end if;
  if v_round.status = 'complete' then
    return; -- idempotent: already completed
  end if;

  update public.multiplayer_rounds
    set status = 'complete', ended_at = now()
    where id = p_round_id;

  for v_player in
    select id from public.multiplayer_players where room_id = v_round.room_id
  loop
    update public.multiplayer_players p
      set total_score = p.total_score + coalesce(
        (select g.score from public.multiplayer_guesses g
          where g.round_id = p_round_id and g.player_id = v_player.id),
        0)
      where p.id = v_player.id;
  end loop;
end;
$$;

-- ── Server clock (for skew-corrected client countdowns) ─────────────────────

create or replace function public.mp_server_now()
returns timestamptz
language sql
stable
set search_path = pg_temp
as $$
  select now();
$$;

-- ── Create room ─────────────────────────────────────────────────────────────

create or replace function public.mp_create_room(
  p_name text,
  p_total_rounds int default 5,
  p_round_duration int default 120
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
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a room.';
  end if;

  v_name := public.mp_clean_name(p_name);
  if char_length(v_name) < 1 then
    raise exception 'Enter a display name.';
  end if;
  if p_total_rounds < 1 or p_total_rounds > 10 then
    raise exception 'Invalid round count.';
  end if;
  if p_round_duration < 15 or p_round_duration > 600 then
    raise exception 'Invalid round duration.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := public.mp_gen_code();
    begin
      insert into public.multiplayer_rooms
        (code, host_id, total_rounds, round_duration_seconds)
      values
        (v_code, v_uid, p_total_rounds, p_round_duration)
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

-- ── Join room by code ───────────────────────────────────────────────────────

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

  -- Idempotent rejoin: already a participant (reconnect / multiple tabs).
  select * into v_existing from public.multiplayer_players
    where room_id = v_room.id and user_id = v_uid;
  if found then
    return json_build_object('room_id', v_room.id, 'code', v_room.code);
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'This match has already started.';
  end if;
  if v_room.expires_at < now() then
    raise exception 'This room has expired. Ask your friend to create a new one.';
  end if;

  v_name := public.mp_clean_name(p_name);
  if char_length(v_name) < 1 then
    raise exception 'Enter a display name.';
  end if;

  select count(*) into v_count from public.multiplayer_players
    where room_id = v_room.id;
  if v_count >= 2 then
    raise exception 'This room is full.';
  end if;

  v_slot := case
    when exists (
      select 1 from public.multiplayer_players
      where room_id = v_room.id and slot = 1
    ) then 2 else 1
  end;

  insert into public.multiplayer_players (room_id, user_id, display_name, slot)
  values (v_room.id, v_uid, v_name, v_slot);

  return json_build_object('room_id', v_room.id, 'code', v_room.code);
end;
$$;

-- ── Start match (host only) ─────────────────────────────────────────────────

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
  if v_count <> 2 then
    raise exception 'You need two players to start.';
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

-- ── Submit guess (idempotent, server-scored) ────────────────────────────────

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
  v_total int;
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

  select count(*) into v_total from public.multiplayer_guesses
    where round_id = v_round.id;
  if v_total >= 2 then
    perform public.mp_complete_round(v_round.id);
  end if;

  return json_build_object('ok', true);
end;
$$;

-- ── Expire round (server enforces the deadline) ─────────────────────────────

create or replace function public.mp_expire_round(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.multiplayer_rooms;
  v_round public.multiplayer_rounds;
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
  if v_room.status <> 'active' then
    return json_build_object('ok', true);
  end if;

  select * into v_round from public.multiplayer_rounds
    where room_id = p_room_id and round_number = v_room.current_round
    for update;
  if not found or v_round.status <> 'active' then
    return json_build_object('ok', true);
  end if;

  -- The server clock is the authority: reject an early expiry attempt.
  if v_round.started_at is null
     or now() < v_round.started_at
         + make_interval(secs => v_room.round_duration_seconds) then
    raise exception 'The round timer has not expired yet.';
  end if;

  perform public.mp_complete_round(v_round.id);
  return json_build_object('ok', true, 'expired', true);
end;
$$;

-- ── Advance round (idempotent; safe under concurrent clicks) ────────────────

create or replace function public.mp_advance_round(p_room_id uuid, p_from_round int)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.multiplayer_rooms;
  v_round public.multiplayer_rounds;
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
  if v_room.status <> 'active' then
    return json_build_object('ok', true);
  end if;

  -- Only the caller whose view matches the current round advances; a second,
  -- concurrent call is a harmless no-op.
  if v_room.current_round <> p_from_round then
    return json_build_object('ok', true, 'noop', true);
  end if;

  select * into v_round from public.multiplayer_rounds
    where room_id = p_room_id and round_number = v_room.current_round
    for update;
  if not found then
    raise exception 'Round not found.';
  end if;
  if v_round.status <> 'complete' then
    raise exception 'The round is not finished yet.';
  end if;

  if v_room.current_round >= v_room.total_rounds then
    update public.multiplayer_rooms
      set status = 'complete', updated_at = now()
      where id = p_room_id;
    return json_build_object('ok', true, 'complete', true);
  end if;

  update public.multiplayer_rounds
    set status = 'active', started_at = now()
    where room_id = p_room_id and round_number = v_room.current_round + 1;

  update public.multiplayer_rooms
    set current_round = current_round + 1, updated_at = now()
    where id = p_room_id;

  return json_build_object('ok', true);
end;
$$;

-- ── Leave room ──────────────────────────────────────────────────────────────

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
    if v_room.host_id = v_uid then
      update public.multiplayer_rooms
        set status = 'abandoned', updated_at = now()
        where id = p_room_id;
    else
      -- Guest leaves the lobby → free their slot for someone else.
      delete from public.multiplayer_players where id = v_player.id;
    end if;
  elsif v_room.status = 'active' then
    update public.multiplayer_players
      set connection_status = 'left'
      where id = v_player.id;
    update public.multiplayer_rooms
      set status = 'abandoned', updated_at = now()
      where id = p_room_id;
  end if;

  return json_build_object('ok', true);
end;
$$;

-- ── Create rematch (idempotent) ─────────────────────────────────────────────

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

  -- Idempotent: if a rematch already exists, both players join the same room.
  if v_room.rematch_room_id is not null then
    select code into v_code from public.multiplayer_rooms
      where id = v_room.rematch_room_id;
    return json_build_object('room_id', v_room.rematch_room_id, 'code', v_code);
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := public.mp_gen_code();
    begin
      insert into public.multiplayer_rooms
        (code, host_id, total_rounds, round_duration_seconds)
      values
        (v_code, v_room.host_id, v_room.total_rounds, v_room.round_duration_seconds)
      returning id into v_new_id;
      exit;
    exception when unique_violation then
      if v_attempts >= 10 then
        raise exception 'Could not allocate a room code. Please try again.';
      end if;
    end;
  end loop;

  -- Copy both players (same identities + slots) into the fresh room, scores 0.
  insert into public.multiplayer_players
    (room_id, user_id, display_name, slot, total_score)
  select v_new_id, user_id, display_name, slot, 0
  from public.multiplayer_players
  where room_id = p_room_id;

  update public.multiplayer_rooms
    set rematch_room_id = v_new_id, updated_at = now()
    where id = p_room_id;

  return json_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;

-- ── Function privileges ─────────────────────────────────────────────────────
-- Public RPCs: callable ONLY by authenticated users (anonymous sessions count
-- as authenticated). Internal helpers: not callable by clients at all.

revoke all on function public.mp_haversine_km(double precision, double precision, double precision, double precision) from public;
revoke all on function public.mp_score(double precision) from public;
revoke all on function public.mp_gen_code() from public;
revoke all on function public.mp_clean_name(text) from public;
revoke all on function public.mp_complete_round(uuid) from public;

revoke all on function public.mp_server_now() from public;
revoke all on function public.mp_create_room(text, int, int) from public;
revoke all on function public.mp_join_room(text, text) from public;
revoke all on function public.mp_start_match(uuid, jsonb) from public;
revoke all on function public.mp_submit_guess(uuid, double precision, double precision) from public;
revoke all on function public.mp_expire_round(uuid) from public;
revoke all on function public.mp_advance_round(uuid, int) from public;
revoke all on function public.mp_leave_room(uuid) from public;
revoke all on function public.mp_create_rematch(uuid) from public;

grant execute on function public.mp_server_now() to authenticated;
grant execute on function public.mp_create_room(text, int, int) to authenticated;
grant execute on function public.mp_join_room(text, text) to authenticated;
grant execute on function public.mp_start_match(uuid, jsonb) to authenticated;
grant execute on function public.mp_submit_guess(uuid, double precision, double precision) to authenticated;
grant execute on function public.mp_expire_round(uuid) to authenticated;
grant execute on function public.mp_advance_round(uuid, int) to authenticated;
grant execute on function public.mp_leave_room(uuid) to authenticated;
grant execute on function public.mp_create_rematch(uuid) to authenticated;

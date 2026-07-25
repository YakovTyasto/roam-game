-- ============================================================================
-- Roam Foundation & Gameplay Polish V3 — custom round count + timer.
--
-- INCREMENTAL migration. Widens the existing round-count bound from 10 to 20
-- (safe: relaxes a check constraint, does not affect existing rows) and lets
-- a solo run specify a custom per-round timer (15-600s) instead of always
-- inheriting the difficulty default. Multiplayer already supported a custom
-- p_round_duration at room creation (see mp_create_room in 0003) — this
-- brings solo runs to parity. Endless is intentionally NOT modeled here: it
-- has no fixed total_rounds and stays a local-only (unranked) solo mode in
-- this phase — see docs/FEATURES_V2_SETUP.md.
--
-- Leaderboard eligibility is untouched: 0005's roam_finalize_solo_run already
-- computes `eligible := (total_rounds = 5)`, so any non-5-round custom game
-- (including the widened 11-20 range) is automatically unranked while still
-- being recorded for personal stats — exactly the V3 ranking rule.
-- ============================================================================

-- Widen total_rounds bounds on both tables that carry it (safe: only relaxes
-- the upper bound, no existing row can violate a *wider* constraint).
alter table public.solo_runs drop constraint if exists solo_runs_total_rounds_check;
alter table public.solo_runs add constraint solo_runs_total_rounds_check
  check (total_rounds between 1 and 20);

alter table public.multiplayer_rooms drop constraint if exists multiplayer_rooms_total_rounds_check;
alter table public.multiplayer_rooms add constraint multiplayer_rooms_total_rounds_check
  check (total_rounds between 1 and 20);

-- roam_create_solo_run gains an optional custom timer parameter. Postgres
-- cannot CREATE OR REPLACE a function to add a new parameter (it would
-- create an ambiguous overload), so the old 3-arg version is dropped first.
drop function if exists public.roam_create_solo_run(text, int, jsonb);

create function public.roam_create_solo_run(
  p_difficulty text,
  p_total_rounds int,
  p_manifest jsonb,
  p_timer_seconds int default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run public.solo_runs;
  v_len int;
  v_elem jsonb;
  v_lat double precision;
  v_lng double precision;
  v_seen text[] := array[]::text[];
  v_duration int;
  i int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  if p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Invalid difficulty.';
  end if;
  if p_total_rounds < 1 or p_total_rounds > 20 then
    raise exception 'Invalid round count.';
  end if;
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'array' then
    raise exception 'Invalid manifest.';
  end if;
  v_len := jsonb_array_length(p_manifest);
  if v_len <> p_total_rounds then
    raise exception 'Manifest must contain exactly % rounds.', p_total_rounds;
  end if;
  if p_timer_seconds is not null and (p_timer_seconds < 15 or p_timer_seconds > 600) then
    raise exception 'Invalid round duration.';
  end if;

  -- Abuse control: keep at most one active run per user.
  update public.solo_runs set status = 'abandoned', updated_at = now()
    where user_id = v_uid and status = 'active';

  v_duration := coalesce(p_timer_seconds, public.mp_difficulty_duration(p_difficulty));

  insert into public.solo_runs
    (user_id, difficulty, total_rounds, round_duration_seconds, current_round)
  values (v_uid, p_difficulty, p_total_rounds, v_duration, 1)
  returning * into v_run;

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
    if coalesce(v_elem ->> 'pano_id', '') = ''
       or coalesce(v_elem ->> 'location_id', '') = ''
       or coalesce(v_elem ->> 'label', '') = ''
       or coalesce(v_elem ->> 'country', '') = '' then
      raise exception 'Malformed round in manifest.';
    end if;
    if (v_elem ->> 'location_id') = any (v_seen) then
      raise exception 'Manifest contains a duplicate location.';
    end if;
    v_seen := array_append(v_seen, v_elem ->> 'location_id');

    insert into public.solo_run_rounds
      (run_id, round_number, pano_id, heading, pitch, zoom,
       location_id, lat, lng, label, country, status, started_at)
    values (
      v_run.id, i + 1,
      v_elem ->> 'pano_id',
      coalesce((v_elem ->> 'heading')::double precision, 0),
      coalesce((v_elem ->> 'pitch')::double precision, 0),
      coalesce((v_elem ->> 'zoom')::double precision, 0),
      v_elem ->> 'location_id', v_lat, v_lng,
      v_elem ->> 'label', v_elem ->> 'country',
      case when i = 0 then 'active' else 'pending' end,
      case when i = 0 then now() else null end
    );
  end loop;

  return json_build_object('run_id', v_run.id, 'difficulty', p_difficulty,
    'total_rounds', p_total_rounds, 'round_duration_seconds', v_duration);
end;
$$;

revoke all on function public.roam_create_solo_run(text, int, jsonb, int) from public;
grant execute on function public.roam_create_solo_run(text, int, jsonb, int) to authenticated;

-- mp_create_room's total_rounds bound also needs widening to 20 (same
-- signature, so CREATE OR REPLACE is safe here — unlike the solo function
-- above, no parameter is being added).
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
  if p_total_rounds < 1 or p_total_rounds > 20 then
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

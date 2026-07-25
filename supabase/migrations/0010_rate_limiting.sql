-- ============================================================================
-- Roam Foundation & Gameplay Polish V3 — server-side rate limiting.
--
-- INCREMENTAL migration. Adds a small, generic fixed-window counter table and
-- a check function that any SECURITY DEFINER RPC can call internally. Not a
-- client-facing RPC itself (no grant to authenticated) — it's only ever
-- invoked from inside another trusted function, so identity always comes
-- from auth.uid() there, never from client input.
--
-- Scope note: this migration wires the counter into a representative,
-- carefully-reviewed subset of the sensitive RPCs (profile writes, room
-- creation, solo run creation, solo run abandonment) as a proven pattern —
-- layering a short "burst" window with a longer "sustained" window via two
-- roam_check_rate_limit calls, exactly as shown below. Applying the same
-- two-line pattern to the remaining listed endpoints (join, start, guess
-- submission, round advance/expiry, finalize, telemetry) is unapplied in
-- this pass to avoid blindly re-pasting large existing function bodies —
-- see the handoff report for the exact follow-up list.
-- ============================================================================

create table if not exists public.rate_limits (
  user_id uuid not null,
  action text not null,
  bucket_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, action, bucket_start)
);

-- Keeps the opportunistic cleanup below cheap even as the table grows.
create index if not exists idx_rate_limits_bucket on public.rate_limits (bucket_start);

alter table public.rate_limits enable row level security;
-- No policies granted → deny-all for clients (RLS enabled, zero permissive
-- policies). Only SECURITY DEFINER functions touch this table, and no
-- client can read another user's rate-limit state.
revoke all on public.rate_limits from anon, authenticated;

-- Fixed-window counter. Raises when the caller has exceeded `p_limit` calls
-- to `p_action` within the current `p_window_seconds` window. The error
-- message always starts with "RATE_LIMITED:" so clients can recognize it
-- without depending on the exact wording (see src/utils/rateLimit.ts).
create or replace function public.roam_check_rate_limit(
  p_action text,
  p_limit int,
  p_window_seconds int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_bucket timestamptz;
  v_count int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (user_id, action, bucket_start, count)
  values (v_uid, p_action, v_bucket, 1)
  on conflict (user_id, action, bucket_start)
    do update set count = rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup (no pg_cron dependency): a small fraction of calls
  -- also purge buckets old enough that no window could still reference them.
  if random() < 0.01 then
    delete from public.rate_limits where bucket_start < now() - interval '1 hour';
  end if;

  if v_count > p_limit then
    raise exception 'RATE_LIMITED: % (max % per %s seconds)', p_action, p_limit, p_window_seconds;
  end if;
end;
$$;

revoke all on function public.roam_check_rate_limit(text, int, int) from public;
-- Deliberately no grant to authenticated/anon: only callable from inside
-- another SECURITY DEFINER function (same owner privileges), never directly.

-- ── Wire the pattern into a representative, carefully-reviewed subset ──────

-- Profile writes: burst 5/minute, sustained 20/hour.
create or replace function public.roam_upsert_profile(p_name text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.roam_check_rate_limit('roam_upsert_profile:burst', 5, 60);
  perform public.roam_check_rate_limit('roam_upsert_profile:sustained', 20, 3600);

  v_name := public.mp_clean_name(p_name);
  if char_length(v_name) < 1 then
    raise exception 'Enter a display name.';
  end if;

  insert into public.player_profiles (user_id, display_name, last_seen_at)
  values (v_uid, v_name, now())
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        last_seen_at = now();

  return json_build_object('display_name', v_name);
end;
$$;

-- Room creation: burst 3/minute, sustained 15/hour.
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
  perform public.roam_check_rate_limit('mp_create_room:burst', 3, 60);
  perform public.roam_check_rate_limit('mp_create_room:sustained', 15, 3600);

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

-- Solo run creation: burst 5/minute, sustained 20/hour.
create or replace function public.roam_create_solo_run(
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
  perform public.roam_check_rate_limit('roam_create_solo_run:burst', 5, 60);
  perform public.roam_check_rate_limit('roam_create_solo_run:sustained', 20, 3600);

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

-- Solo run abandonment: sustained 20/hour (a lighter-weight action).
create or replace function public.roam_abandon_solo_run(p_run_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated boolean;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.roam_check_rate_limit('roam_abandon_solo_run', 20, 3600);

  update public.solo_runs
    set status = 'abandoned', updated_at = now()
    where id = p_run_id and user_id = v_uid and status = 'active';

  v_updated := found;
  return json_build_object('ok', true, 'abandoned', v_updated);
end;
$$;

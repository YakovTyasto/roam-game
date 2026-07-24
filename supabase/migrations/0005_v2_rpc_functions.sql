-- ============================================================================
-- Roam v2 — RPCs for profiles, server-authoritative solo runs, multiplayer
-- result recording, and the sanitized weekly leaderboard read.
--
-- INCREMENTAL migration. Depends on 0003 (party rooms) and 0004 (profiles,
-- solo runs, game_results, week helpers). Nothing here edits 0001/0002.
--
-- Every function is SECURITY DEFINER with an explicit search_path. Identity is
-- always auth.uid(); scores are computed server-side with the existing trusted
-- helpers (mp_haversine_km / mp_score). Clients cannot pass a final score.
-- ============================================================================

-- ── Profiles ────────────────────────────────────────────────────────────────

-- Create or rename the caller's profile. Name is sanitized server-side with the
-- same rules as multiplayer display names. Also (re)stamps last_seen_at.
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

-- Return the caller's profile (or null) and refresh last_seen_at. Lets the
-- client reconcile its local cache against the authoritative name.
create or replace function public.roam_get_profile()
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
    return json_build_object('exists', false);
  end if;

  select display_name into v_name from public.player_profiles where user_id = v_uid;
  if v_name is null then
    return json_build_object('exists', false);
  end if;

  update public.player_profiles set last_seen_at = now() where user_id = v_uid;
  return json_build_object('exists', true, 'display_name', v_name);
end;
$$;

-- ── Solo runs (server-authoritative) ────────────────────────────────────────

-- Start a solo run from a validated manifest. Reuses the multiplayer manifest
-- contract (each round carries render info + the hidden answer). Only one
-- active run per user: any earlier active run is abandoned first.
create or replace function public.roam_create_solo_run(
  p_difficulty text,
  p_total_rounds int,
  p_manifest jsonb
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
  if p_total_rounds < 1 or p_total_rounds > 10 then
    raise exception 'Invalid round count.';
  end if;
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'array' then
    raise exception 'Invalid manifest.';
  end if;
  v_len := jsonb_array_length(p_manifest);
  if v_len <> p_total_rounds then
    raise exception 'Manifest must contain exactly % rounds.', p_total_rounds;
  end if;

  -- Abuse control: keep at most one active run per user.
  update public.solo_runs set status = 'abandoned', updated_at = now()
    where user_id = v_uid and status = 'active';

  v_duration := public.mp_difficulty_duration(p_difficulty);

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

-- Submit one solo guess. Server scores it with the trusted helpers, records it
-- idempotently, marks the round complete, advances the run, and reveals the
-- answer for THAT round only.
create or replace function public.roam_submit_solo_guess(
  p_run_id uuid,
  p_round_number int,
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
  v_run public.solo_runs;
  v_round public.solo_run_rounds;
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

  select * into v_run from public.solo_runs
    where id = p_run_id and user_id = v_uid
    for update;
  if not found then
    raise exception 'Solo run not found.';
  end if;
  if v_run.status <> 'active' then
    raise exception 'This run is no longer active.';
  end if;

  select * into v_round from public.solo_run_rounds
    where run_id = p_run_id and round_number = p_round_number
    for update;
  if not found then
    raise exception 'Round not found.';
  end if;

  v_dist := public.mp_haversine_km(p_lat, p_lng, v_round.lat, v_round.lng);
  v_score := public.mp_score(v_dist);

  insert into public.solo_run_guesses (run_id, round_id, lat, lng, distance_km, score)
  values (p_run_id, v_round.id, p_lat, p_lng, v_dist, v_score)
  on conflict (round_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    update public.solo_run_rounds set status = 'complete' where id = v_round.id;
    update public.solo_runs
      set total_score = total_score + v_score,
          current_round = least(current_round + 1, total_rounds + 1),
          updated_at = now()
      where id = p_run_id;
    -- Activate the next round if any.
    update public.solo_run_rounds
      set status = 'active', started_at = now()
      where run_id = p_run_id and round_number = p_round_number + 1
        and status = 'pending';
  end if;

  -- Reveal the answer for this round (idempotent for repeat submits).
  return json_build_object(
    'score', coalesce((select score from public.solo_run_guesses where round_id = v_round.id), v_score),
    'distance_km', coalesce((select distance_km from public.solo_run_guesses where round_id = v_round.id), v_dist),
    'location_id', v_round.location_id,
    'lat', v_round.lat, 'lng', v_round.lng,
    'label', v_round.label, 'country', v_round.country
  );
end;
$$;

-- Finalize a solo run exactly once and record a leaderboard-eligible result.
create or replace function public.roam_finalize_solo_run(p_run_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run public.solo_runs;
  v_completed int;
  v_total int;
  v_max int;
  v_eligible boolean;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_run from public.solo_runs
    where id = p_run_id and user_id = v_uid
    for update;
  if not found then
    raise exception 'Solo run not found.';
  end if;

  -- Idempotent: already finalized.
  if v_run.status = 'complete' then
    return json_build_object('total_score', v_run.total_score, 'already', true);
  end if;
  if v_run.status <> 'active' then
    raise exception 'This run cannot be finalized.';
  end if;

  select count(*) into v_completed from public.solo_run_rounds
    where run_id = p_run_id and status = 'complete';
  if v_completed < v_run.total_rounds then
    raise exception 'All rounds must be completed before finalizing.';
  end if;

  select coalesce(sum(score), 0) into v_total from public.solo_run_guesses
    where run_id = p_run_id;
  v_max := v_run.total_rounds * 5000;
  v_eligible := (v_run.total_rounds = 5);

  update public.solo_runs
    set status = 'complete', total_score = v_total,
        finalized_at = now(), updated_at = now()
    where id = p_run_id;

  insert into public.game_results
    (user_id, mode, difficulty, game_id, raw_score, max_score, round_count,
     placement, player_count, is_win, is_tie, completed_at, week_start, eligible)
  values
    (v_uid, 'solo', v_run.difficulty, p_run_id, v_total, v_max, v_run.total_rounds,
     1, 1, false, false, now(), public.roam_week_start(now()), v_eligible)
  on conflict (mode, game_id, user_id) do nothing;

  return json_build_object('total_score', v_total, 'max_score', v_max,
    'eligible', v_eligible);
end;
$$;

-- Return the caller's active solo run for resume-after-refresh. Reveals answers
-- only for rounds already completed; pending/active rounds expose render info
-- (pano/heading) but NOT their coordinates.
create or replace function public.roam_get_active_solo_run()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run public.solo_runs;
begin
  if v_uid is null then
    return json_build_object('active', false);
  end if;

  select * into v_run from public.solo_runs
    where user_id = v_uid and status = 'active'
    order by created_at desc
    limit 1;
  if not found then
    return json_build_object('active', false);
  end if;

  return json_build_object(
    'active', true,
    'run_id', v_run.id,
    'difficulty', v_run.difficulty,
    'total_rounds', v_run.total_rounds,
    'round_duration_seconds', v_run.round_duration_seconds,
    'current_round', v_run.current_round,
    'total_score', v_run.total_score,
    'rounds', coalesce((
      select json_agg(json_build_object(
        'round_number', r.round_number,
        'pano_id', r.pano_id,
        'heading', r.heading,
        'pitch', r.pitch,
        'zoom', r.zoom,
        'status', r.status,
        -- Reveal the answer + guess only for completed rounds.
        'label', case when r.status = 'complete' then r.label else null end,
        'country', case when r.status = 'complete' then r.country else null end,
        'lat', case when r.status = 'complete' then r.lat else null end,
        'lng', case when r.status = 'complete' then r.lng else null end,
        'guess_lat', g.lat,
        'guess_lng', g.lng,
        'distance_km', g.distance_km,
        'score', g.score
      ) order by r.round_number)
      from public.solo_run_rounds r
      left join public.solo_run_guesses g on g.round_id = r.id
      where r.run_id = v_run.id
    ), '[]'::json)
  );
end;
$$;

-- ── Multiplayer result recording ────────────────────────────────────────────

-- Record one game_results row per participating player when a match completes.
-- Idempotent (unique (mode, game_id, user_id)). Placement uses competition
-- ranking on total_score (1,2,2,4…); ties at the top are flagged is_tie.
create or replace function public.mp_record_match_results(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.multiplayer_rooms;
  v_max int;
  v_participants int;
  v_top int;
  v_winners int;
  v_eligible boolean;
begin
  select * into v_room from public.multiplayer_rooms where id = p_room_id;
  if not found or v_room.status <> 'complete' then
    return;
  end if;

  -- Participants: players who submitted at least one guess in the match.
  select count(distinct p.id) into v_participants
  from public.multiplayer_players p
  where p.room_id = p_room_id
    and exists (select 1 from public.multiplayer_guesses g where g.player_id = p.id);
  if v_participants < 2 then
    return; -- not a real multiplayer game
  end if;

  v_max := v_room.total_rounds * 5000;
  v_eligible := (v_room.total_rounds = 5);

  select max(total_score) into v_top
  from public.multiplayer_players
  where room_id = p_room_id
    and exists (select 1 from public.multiplayer_guesses g where g.player_id = multiplayer_players.id);

  select count(*) into v_winners
  from public.multiplayer_players
  where room_id = p_room_id and total_score = v_top
    and exists (select 1 from public.multiplayer_guesses g where g.player_id = multiplayer_players.id);

  insert into public.game_results
    (user_id, mode, difficulty, game_id, raw_score, max_score, round_count,
     placement, player_count, is_win, is_tie, completed_at, week_start, eligible)
  select
    p.user_id, 'multiplayer', v_room.difficulty, p_room_id,
    p.total_score, v_max, v_room.total_rounds,
    1 + (select count(*) from public.multiplayer_players o
          where o.room_id = p_room_id and o.total_score > p.total_score
            and exists (select 1 from public.multiplayer_guesses g where g.player_id = o.id)),
    v_participants,
    (p.total_score = v_top),
    (p.total_score = v_top and v_winners > 1),
    now(), public.roam_week_start(now()), v_eligible
  from public.multiplayer_players p
  where p.room_id = p_room_id
    and exists (select 1 from public.multiplayer_guesses g where g.player_id = p.id)
  on conflict (mode, game_id, user_id) do nothing;
end;
$$;

-- Replace mp_advance_round so match completion records leaderboard results.
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
    perform public.mp_record_match_results(p_room_id);
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

-- ── Weekly leaderboard read (sanitized; no UUIDs exposed) ────────────────────

create or replace function public.roam_leaderboard(
  p_mode text,
  p_difficulty text,
  p_limit int default 50,
  p_at timestamptz default now()
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ws timestamptz := public.roam_week_start(p_at);
  v_we timestamptz := public.roam_week_end(p_at);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_entries json;
  v_self json;
begin
  if p_mode not in ('solo', 'multiplayer') then
    raise exception 'Invalid mode.';
  end if;
  if p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Invalid difficulty.';
  end if;

  with res as (
    select r.user_id, r.raw_score, r.is_win, r.completed_at
    from public.game_results r
    where r.week_start = v_ws
      and r.mode = p_mode
      and r.difficulty = p_difficulty
      and r.eligible
  ),
  best as (
    select user_id,
           max(raw_score) as best_score,
           count(*) as games,
           count(*) filter (where is_win) as wins,
           round(avg(raw_score))::int as avg_score
    from res group by user_id
  ),
  best_at as (
    select res.user_id, min(res.completed_at) as achieved_at
    from res join best on best.user_id = res.user_id
      and res.raw_score = best.best_score
    group by res.user_id
  ),
  needed as (
    select ba.user_id, count(*) as games_needed
    from res join best_at ba on ba.user_id = res.user_id
      and res.completed_at <= ba.achieved_at
    group by ba.user_id
  ),
  ranked as (
    select b.user_id, b.best_score, b.games, b.wins, b.avg_score,
           n.games_needed, ba.achieved_at,
           coalesce(p.display_name, 'Player') as display_name,
           row_number() over (
             order by b.best_score desc, b.wins desc,
                      n.games_needed asc, ba.achieved_at asc
           ) as rnk
    from best b
    join best_at ba using (user_id)
    join needed n using (user_id)
    left join public.player_profiles p on p.user_id = b.user_id
  )
  select
    coalesce((
      select json_agg(e order by e_rnk) from (
        select json_build_object(
          'rank', rnk,
          'display_name', display_name,
          'best_score', best_score,
          'games_completed', games,
          'wins', wins,
          'avg_score', avg_score,
          'is_self', (user_id = v_uid)
        ) as e, rnk as e_rnk
        from ranked
        order by rnk
        limit v_limit
      ) top
    ), '[]'::json),
    (
      select json_build_object(
        'rank', rnk,
        'display_name', display_name,
        'best_score', best_score,
        'games_completed', games,
        'wins', wins,
        'avg_score', avg_score,
        'is_self', true
      )
      from ranked where user_id = v_uid
    )
  into v_entries, v_self;

  return json_build_object(
    'week_start', v_ws,
    'week_end', v_we,
    'mode', p_mode,
    'difficulty', p_difficulty,
    'entries', v_entries,
    'self', v_self
  );
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke all on function public.roam_upsert_profile(text) from public;
revoke all on function public.roam_get_profile() from public;
revoke all on function public.roam_create_solo_run(text, int, jsonb) from public;
revoke all on function public.roam_submit_solo_guess(uuid, int, double precision, double precision) from public;
revoke all on function public.roam_finalize_solo_run(uuid) from public;
revoke all on function public.roam_get_active_solo_run() from public;
revoke all on function public.mp_record_match_results(uuid) from public;
revoke all on function public.mp_advance_round(uuid, int) from public;
revoke all on function public.roam_leaderboard(text, text, int, timestamptz) from public;

grant execute on function public.roam_upsert_profile(text) to authenticated;
grant execute on function public.roam_get_profile() to authenticated;
grant execute on function public.roam_create_solo_run(text, int, jsonb) to authenticated;
grant execute on function public.roam_submit_solo_guess(uuid, int, double precision, double precision) to authenticated;
grant execute on function public.roam_finalize_solo_run(uuid) to authenticated;
grant execute on function public.roam_get_active_solo_run() to authenticated;
grant execute on function public.roam_leaderboard(text, text, int, timestamptz) to authenticated;
-- mp_record_match_results stays server-only (called from mp_advance_round).

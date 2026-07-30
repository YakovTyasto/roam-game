-- ============================================================================
-- Roam Engagement Core V5 — official, catalog-driven runs.
--
-- INCREMENTAL migration on top of 0014. Additive only:
--   • three nullable/defaulted columns on existing tables,
--   • new `*_v2` RPCs that select rounds from public.game_catalog,
--   • no existing function is dropped and no existing signature changes.
--
-- ROLLOUT CONTRACT — WHY EVERYTHING IS `_v2`
-- Migrations are applied before the frontend deploys, so for a while the
-- currently-deployed client is talking to this schema. That client calls
-- roam_create_solo_run(p_manifest) and mp_start_match(p_manifest) with a
-- client-built manifest. Those functions are therefore left completely intact
-- and keep working; the new server-authoritative behaviour lives in new
-- functions with new names. Nothing is destructively replaced in this rollout.
-- The cleanup pass that removes the legacy manifest path is a LATER release and
-- is spelled out in docs/ENGAGEMENT_CORE_V5.md.
--
-- WHAT "OFFICIAL" MEANS HERE
-- An official run's rounds are chosen by the server from the catalog, and the
-- browser is told only what it needs to render the current round:
--   round number, pano id, heading/pitch/zoom, server start time, server
--   deadline, and the run's difficulty/round count.
-- It is NOT told lat, lng, label or country until that round is completed. Every
-- guess is scored server-side with the existing trusted helpers
-- (mp_haversine_km / mp_score) — there is no second scoring implementation.
-- ============================================================================

-- ── Additive columns ────────────────────────────────────────────────────────

-- Which official mode a run belongs to. Defaulted, so every pre-existing row
-- (and every run created by the old client) is a plain 'solo' run exactly as
-- before. 'practice' marks a replay after an official attempt is already
-- finished — playable, never leaderboard-eligible.
alter table public.solo_runs
  add column if not exists mode text not null default 'solo';
alter table public.solo_runs drop constraint if exists solo_runs_mode_check;
alter table public.solo_runs add constraint solo_runs_mode_check
  check (mode in ('solo', 'daily', 'challenge', 'practice'));

-- True when the rounds came from the server catalog rather than a client
-- manifest. This is the flag that separates a comparable, official result from a
-- legacy/local one, and it can only ever be set by the functions below.
alter table public.solo_runs
  add column if not exists server_selected boolean not null default false;

-- Canonical group of each round's location, so novelty/diversity accounting and
-- the "no duplicate place in one run" guarantee work without a catalog join.
alter table public.solo_run_rounds
  add column if not exists group_id text;

-- Per-round deadline anchor. `started_at` already exists; storing the resolved
-- duration on the run is enough, but a late submission needs an explicit,
-- server-owned expiry that a client clock cannot influence.
alter table public.solo_run_rounds
  add column if not exists expires_at timestamptz;

create index if not exists idx_solo_runs_user_mode
  on public.solo_runs (user_id, mode, status);

-- ── Internal: materialise a selected round set into a run ───────────────────
-- Shared by every official mode (solo now; Daily and shared challenges in the
-- following migrations) so there is exactly one place that writes rounds.
--
-- `p_rounds` is the jsonb array produced by roam_select_catalog_rounds (or read
-- back from a stored daily/challenge round set). It always contains answers;
-- this function is internal and never returns them.
create or replace function public.roam_write_run_rounds(
  p_run_id uuid,
  p_rounds jsonb,
  p_duration int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_elem jsonb;
  v_len int := jsonb_array_length(p_rounds);
  i int;
begin
  for i in 0 .. v_len - 1 loop
    v_elem := p_rounds -> i;
    insert into public.solo_run_rounds
      (run_id, round_number, pano_id, heading, pitch, zoom,
       location_id, group_id, lat, lng, label, country, status, started_at, expires_at)
    values (
      p_run_id, i + 1,
      v_elem ->> 'pano_id',
      coalesce((v_elem ->> 'heading')::double precision, 0),
      coalesce((v_elem ->> 'pitch')::double precision, 0),
      coalesce((v_elem ->> 'zoom')::double precision, 0),
      v_elem ->> 'location_id',
      v_elem ->> 'group_id',
      (v_elem ->> 'lat')::double precision,
      (v_elem ->> 'lng')::double precision,
      v_elem ->> 'label',
      v_elem ->> 'country',
      case when i = 0 then 'active' else 'pending' end,
      case when i = 0 then now() else null end,
      case when i = 0 then now() + make_interval(secs => p_duration) else null end
    );
  end loop;
end;
$$;

-- ── Internal: the caller's recently-played canonical groups ─────────────────
-- A cooldown input for selection, never returned to anyone.
create or replace function public.roam_recent_groups_for(p_uid uuid, p_limit int default 250)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(group_id), '{}')
    from (
      select group_id from public.location_history
       where user_id = p_uid
       order by played_at desc, group_id
       limit greatest(1, least(coalesce(p_limit, 250), 1000))
    ) recent;
$$;

-- ── Internal: charge a place against the player's novelty history ───────────
-- Called when a round CLOSES, not when it is selected. A player who abandons a
-- run never saw its later rounds, so charging those would burn freshness they
-- never spent — the same rule the client applies in src/diversity/store.ts. A
-- round that expired unanswered *was* on screen, so it is charged too.
create or replace function public.roam_charge_group_played(
  p_uid uuid,
  p_group_id text,
  p_difficulty text,
  p_mode text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.location_history (user_id, group_id, difficulty, mode, played_at)
  select p_uid, p_group_id, p_difficulty,
         -- location_history.mode has its own allowed set; 'practice' is a solo
         -- replay as far as novelty is concerned.
         case when p_mode in ('solo', 'endless', 'multiplayer', 'daily', 'challenge', 'streak')
              then p_mode else 'solo' end,
         now()
   where p_uid is not null and p_group_id is not null
  on conflict (user_id, group_id) do update set played_at = excluded.played_at;
$$;

-- ── Internal: the render-safe view of a run ─────────────────────────────────
-- THE answer-secrecy boundary. Everything a client learns about a run goes
-- through here, so there is one place to audit.
--
-- Completed rounds reveal their answer and the player's guess. Active and
-- pending rounds expose only what is needed to draw a panorama. `p_reveal_all`
-- is set exclusively by finalization/results paths, after the run is over.
create or replace function public.roam_run_payload(p_run_id uuid, p_reveal_all boolean default false)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.solo_runs;
begin
  select * into v_run from public.solo_runs where id = p_run_id;
  if not found then
    return json_build_object('found', false);
  end if;

  return json_build_object(
    'found', true,
    'run_id', v_run.id,
    'mode', v_run.mode,
    'difficulty', v_run.difficulty,
    'total_rounds', v_run.total_rounds,
    'round_duration_seconds', v_run.round_duration_seconds,
    'current_round', v_run.current_round,
    'total_score', v_run.total_score,
    'status', v_run.status,
    'server_selected', v_run.server_selected,
    'server_now', now(),
    'expires_at', v_run.expires_at,
    'finalized_at', v_run.finalized_at,
    'rounds', coalesce((
      select json_agg(json_build_object(
        'round_number', r.round_number,
        'pano_id', r.pano_id,
        'heading', r.heading,
        'pitch', r.pitch,
        'zoom', r.zoom,
        'status', r.status,
        'started_at', r.started_at,
        'expires_at', r.expires_at,
        -- The reveal gate. Note `location_id` is withheld too: it is a catalog
        -- key, and a client that collected keys could correlate them with the
        -- bundled offline catalog to recover the answer.
        'location_id', case when p_reveal_all or r.status = 'complete' then r.location_id end,
        'label', case when p_reveal_all or r.status = 'complete' then r.label end,
        'country', case when p_reveal_all or r.status = 'complete' then r.country end,
        'lat', case when p_reveal_all or r.status = 'complete' then r.lat end,
        'lng', case when p_reveal_all or r.status = 'complete' then r.lng end,
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

-- ── Start an official solo run (server-selected rounds) ─────────────────────
create or replace function public.roam_start_official_run_v2(
  p_difficulty text,
  p_total_rounds int default 5,
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
  v_duration int;
  v_rounds jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.roam_check_rate_limit('roam_start_official_run:burst', 5, 60);
  perform public.roam_check_rate_limit('roam_start_official_run:sustained', 30, 3600);

  if p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Invalid difficulty.';
  end if;
  if p_total_rounds < 1 or p_total_rounds > 20 then
    raise exception 'Invalid round count.';
  end if;
  if p_timer_seconds is not null and (p_timer_seconds < 15 or p_timer_seconds > 600) then
    raise exception 'Invalid round duration.';
  end if;

  -- At most one active run per player, exactly as the legacy path does.
  update public.solo_runs set status = 'abandoned', updated_at = now()
    where user_id = v_uid and status = 'active';

  v_duration := coalesce(p_timer_seconds, public.mp_difficulty_duration(p_difficulty));

  -- Server-side selection. The client cannot influence which places it gets
  -- beyond the difficulty it asked for.
  v_rounds := public.roam_select_catalog_rounds(
    p_difficulty,
    p_total_rounds,
    '{}',
    public.roam_recent_groups_for(v_uid)
  );

  insert into public.solo_runs
    (user_id, difficulty, total_rounds, round_duration_seconds, current_round,
     mode, server_selected)
  values (v_uid, p_difficulty, p_total_rounds, v_duration, 1, 'solo', true)
  returning * into v_run;

  perform public.roam_write_run_rounds(v_run.id, v_rounds, v_duration);

  return public.roam_run_payload(v_run.id);
end;
$$;

-- ── Read the caller's active official run (resume) ──────────────────────────
create or replace function public.roam_get_official_run_v2(p_run_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run_id uuid;
begin
  if v_uid is null then
    return json_build_object('found', false);
  end if;

  if p_run_id is null then
    select id into v_run_id from public.solo_runs
      where user_id = v_uid and status = 'active'
      order by created_at desc
      limit 1;
  else
    -- Ownership check: another player's run id must not resolve, ever.
    select id into v_run_id from public.solo_runs
      where id = p_run_id and user_id = v_uid;
  end if;

  if v_run_id is null then
    return json_build_object('found', false);
  end if;
  return public.roam_run_payload(v_run_id);
end;
$$;

-- ── Submit one official guess ──────────────────────────────────────────────
-- Identity from auth.uid(); membership validated; the round row is locked for
-- the duration; idempotent; scored server-side; reveals only the round just
-- completed; totals updated exactly once.
create or replace function public.roam_submit_official_guess_v2(
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
  v_existing public.solo_run_guesses;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lng is null or p_lng < -180 or p_lng > 180
     or p_lat <> p_lat or p_lng <> p_lng then  -- NaN is not caught by a range test
    raise exception 'Invalid guess coordinates.';
  end if;

  perform public.roam_check_rate_limit('roam_submit_official_guess', 240, 3600);

  -- Lock the run first, then the round: a consistent order, so two concurrent
  -- submissions for the same run can never deadlock against each other.
  select * into v_run from public.solo_runs
    where id = p_run_id and user_id = v_uid
    for update;
  if not found then
    -- Deliberately the same message whether the run belongs to someone else or
    -- does not exist: a caller must not be able to probe for valid run ids.
    raise exception 'Run not found.';
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

  -- Idempotency comes first: a retry of an already-scored round returns the
  -- stored result rather than re-scoring or erroring, even if the round has
  -- since expired or the run has moved on.
  select * into v_existing from public.solo_run_guesses where round_id = v_round.id;
  if found then
    return json_build_object(
      'score', v_existing.score,
      'distance_km', v_existing.distance_km,
      'location_id', v_round.location_id,
      'lat', v_round.lat, 'lng', v_round.lng,
      'label', v_round.label, 'country', v_round.country,
      'already', true,
      'current_round', v_run.current_round,
      'total_score', v_run.total_score
    );
  end if;

  -- Too early: a pending round has not been served to the player yet, so a
  -- guess for it could only come from a client racing ahead.
  if v_round.status = 'pending' then
    raise exception 'That round has not started yet.';
  end if;

  -- Too late: the deadline is the server's, computed from the server's own
  -- started_at. A late guess is not scored — but the round is closed so the run
  -- can still be finished, matching how multiplayer expiry behaves.
  if v_round.expires_at is not null and now() > v_round.expires_at then
    update public.solo_run_rounds set status = 'complete' where id = v_round.id;
    insert into public.solo_run_guesses (run_id, round_id, lat, lng, distance_km, score)
    values (p_run_id, v_round.id, p_lat, p_lng,
            public.mp_haversine_km(p_lat, p_lng, v_round.lat, v_round.lng), 0)
    on conflict (round_id) do nothing;
    update public.solo_runs
      set current_round = least(current_round + 1, total_rounds + 1), updated_at = now()
      where id = p_run_id;
    update public.solo_run_rounds
      set status = 'active', started_at = now(),
          expires_at = now() + make_interval(secs => v_run.round_duration_seconds)
      where run_id = p_run_id and round_number = p_round_number + 1 and status = 'pending';
    -- The place was on screen even though the answer never arrived.
    perform public.roam_charge_group_played(
      v_uid, v_round.group_id, v_run.difficulty, v_run.mode);
    return json_build_object(
      'score', 0,
      'distance_km', public.mp_haversine_km(p_lat, p_lng, v_round.lat, v_round.lng),
      'location_id', v_round.location_id,
      'lat', v_round.lat, 'lng', v_round.lng,
      'label', v_round.label, 'country', v_round.country,
      'expired', true
    );
  end if;

  -- Trusted, existing scoring helpers. No second implementation.
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
    -- Activate the next round and stamp its server deadline.
    update public.solo_run_rounds
      set status = 'active', started_at = now(),
          expires_at = now() + make_interval(secs => v_run.round_duration_seconds)
      where run_id = p_run_id and round_number = p_round_number + 1
        and status = 'pending';
    -- Novelty accounting: charge the place only now that it was really played.
    perform public.roam_charge_group_played(
      v_uid, v_round.group_id, v_run.difficulty, v_run.mode);
  end if;

  return json_build_object(
    'score', v_score,
    'distance_km', v_dist,
    'location_id', v_round.location_id,
    'lat', v_round.lat, 'lng', v_round.lng,
    'label', v_round.label, 'country', v_round.country,
    'already', false
  );
end;
$$;

-- ── Finalize an official run exactly once ──────────────────────────────────
create or replace function public.roam_finalize_official_run_v2(p_run_id uuid)
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
  v_distance double precision;
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
    raise exception 'Run not found.';
  end if;

  -- Idempotent: a second finalize returns the same numbers and writes nothing.
  if v_run.status = 'complete' then
    return json_build_object(
      'total_score', v_run.total_score, 'already', true,
      'max_score', v_run.total_rounds * 5000,
      'run_id', v_run.id, 'mode', v_run.mode
    );
  end if;
  if v_run.status <> 'active' then
    raise exception 'This run cannot be finalized.';
  end if;

  select count(*) into v_completed from public.solo_run_rounds
    where run_id = p_run_id and status = 'complete';
  if v_completed < v_run.total_rounds then
    raise exception 'All rounds must be completed before finalizing.';
  end if;

  select coalesce(sum(score), 0), coalesce(sum(distance_km), 0)
    into v_total, v_distance
    from public.solo_run_guesses where run_id = p_run_id;

  v_max := v_run.total_rounds * 5000;
  -- Weekly-leaderboard eligibility is unchanged: exactly the standard round
  -- count, and never a practice replay.
  v_eligible := (v_run.total_rounds = 5 and v_run.mode <> 'practice');

  update public.solo_runs
    set status = 'complete', total_score = v_total,
        finalized_at = now(), updated_at = now()
    where id = p_run_id;

  -- game_results.mode only accepts 'solo'/'multiplayer' (0004). Official
  -- non-solo modes keep their own result tables (added in 0016/0017) and record
  -- here as 'solo' only when they are a plain solo run, so the weekly
  -- leaderboard's meaning does not silently change.
  if v_run.mode in ('solo', 'practice') then
    insert into public.game_results
      (user_id, mode, difficulty, game_id, raw_score, max_score, round_count,
       placement, player_count, is_win, is_tie, completed_at, week_start, eligible)
    values
      (v_uid, 'solo', v_run.difficulty, p_run_id, v_total, v_max, v_run.total_rounds,
       1, 1, false, false, now(), public.roam_week_start(now()), v_eligible)
    on conflict (mode, game_id, user_id) do nothing;
  end if;

  return json_build_object(
    'run_id', v_run.id,
    'mode', v_run.mode,
    'total_score', v_total,
    'total_distance_km', v_distance,
    'max_score', v_max,
    'eligible', v_eligible,
    'already', false
  );
end;
$$;

-- ── Multiplayer: server-selected manifest ──────────────────────────────────
-- Same contract as mp_start_match, minus the client manifest. The host can no
-- longer choose (or fabricate) the locations. Room difficulty, round count,
-- capacity, timers, shared locations, reconnect, rematch and results all behave
-- exactly as before — this only changes where the rounds come from.
--
-- Room-wide novelty is applied here rather than by the host client: the server
-- can read every participant's history directly, so nothing about who saw what
-- has to leave the database at all (compare roam_room_recent_groups in 0012,
-- which had to anonymise an aggregate precisely because the client did the
-- ranking).
create or replace function public.mp_start_match_v2(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.multiplayer_rooms;
  v_count int;
  v_rounds jsonb;
  v_elem jsonb;
  v_round_id uuid;
  v_recent text[];
  i int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.roam_check_rate_limit('mp_start_match:burst', 10, 60);

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

  -- Everything every participant has played recently, as a plain cooldown
  -- input. Never returned; no per-player attribution is possible.
  select coalesce(array_agg(distinct h.group_id), '{}') into v_recent
    from public.location_history h
    join public.multiplayer_players p
      on p.user_id = h.user_id
     and p.room_id = p_room_id
     and p.connection_status <> 'left'
   where h.played_at > now() - interval '30 days';

  v_rounds := public.roam_select_catalog_rounds(
    v_room.difficulty, v_room.total_rounds, '{}', v_recent
  );

  for i in 0 .. jsonb_array_length(v_rounds) - 1 loop
    v_elem := v_rounds -> i;
    insert into public.multiplayer_rounds
      (room_id, round_number, pano_id, heading, pitch, zoom, status, started_at)
    values (
      p_room_id, i + 1,
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
      (v_elem ->> 'lat')::double precision,
      (v_elem ->> 'lng')::double precision,
      v_elem ->> 'label', v_elem ->> 'country'
    );
  end loop;

  update public.multiplayer_rooms
    set status = 'active', current_round = 1, updated_at = now()
    where id = p_room_id;

  return json_build_object('room_id', p_room_id, 'code', v_room.code,
    'server_selected', true);
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on function public.roam_write_run_rounds(uuid, jsonb, int)
  from public, anon, authenticated;
revoke all on function public.roam_recent_groups_for(uuid, int)
  from public, anon, authenticated;
revoke all on function public.roam_charge_group_played(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.roam_run_payload(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.roam_start_official_run_v2(text, int, int)
  from public, anon, authenticated;
revoke all on function public.roam_get_official_run_v2(uuid)
  from public, anon, authenticated;
revoke all on function public.roam_submit_official_guess_v2(uuid, int, double precision, double precision)
  from public, anon, authenticated;
revoke all on function public.roam_finalize_official_run_v2(uuid)
  from public, anon, authenticated;
revoke all on function public.mp_start_match_v2(uuid) from public, anon, authenticated;

-- Internal helpers stay ungranted: roam_write_run_rounds, roam_recent_groups_for
-- and roam_run_payload all handle answers and take a caller-supplied identity or
-- reveal flag, so they must never be reachable from a browser.
grant execute on function public.roam_start_official_run_v2(text, int, int) to authenticated;
grant execute on function public.roam_get_official_run_v2(uuid) to authenticated;
grant execute on function public.roam_submit_official_guess_v2(uuid, int, double precision, double precision)
  to authenticated;
grant execute on function public.roam_finalize_official_run_v2(uuid) to authenticated;
grant execute on function public.mp_start_match_v2(uuid) to authenticated;

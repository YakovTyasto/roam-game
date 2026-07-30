-- ============================================================================
-- Roam Engagement Core V5 — the Daily Challenge.
--
-- INCREMENTAL migration on top of 0015. Additive: three new tables, a
-- finalization hook, and new RPCs. The only existing function replaced is
-- roam_finalize_official_run_v2, which was introduced in 0015 *in this same
-- release* — no previously-deployed client has ever called it, so replacing it
-- here is not a compatibility break. Every pre-V5 RPC is untouched.
--
-- THE RULES THIS ENFORCES (all server-side; none of them are client promises)
--   • One challenge per UTC calendar day. Everyone gets the same locations in
--     the same order.
--   • Exactly one official scored attempt per authenticated user per UTC day.
--   • A partially played attempt resumes; a completed one can never be replayed
--     for a second official score.
--   • Practice is allowed only after the official attempt is complete, and can
--     never overwrite the official result.
--   • Server time defines both the day and every deadline.
--   • A round's answer stays hidden until that round is completed, and a future
--     day's rounds are unreachable — there is no code path that will generate or
--     read a day later than today.
--
-- WHY THERE IS NO PUBLIC SEED
-- A tempting design is `hash(secret? no — day) → locations`, so any client can
-- verify the draw. That also lets any client *precompute every future day*. The
-- selection therefore uses the server's PRNG once, inside a transaction, and
-- persists the outcome. Determinism is achieved by storing the result, not by
-- making it reproducible from public input.
-- ============================================================================

-- ── UTC day helper ──────────────────────────────────────────────────────────
-- Every day boundary in this feature goes through this one function, so "which
-- day is it?" cannot be answered two different ways.
create or replace function public.roam_utc_day(p_at timestamptz default now())
returns date
language sql
immutable
set search_path = pg_temp
as $$ select (p_at at time zone 'UTC')::date $$;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.daily_challenges (
  utc_day date primary key,
  difficulty text not null default 'normal'
    check (difficulty in ('easy', 'normal', 'hard')),
  round_count int not null default 5 check (round_count between 1 and 10),
  timer_seconds int not null check (timer_seconds between 15 and 600),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_challenge_rounds (
  utc_day date not null references public.daily_challenges (utc_day) on delete cascade,
  round_number int not null check (round_number >= 1),
  location_id text not null,
  group_id text not null,
  pano_id text not null,
  heading double precision not null default 0,
  pitch double precision not null default 0,
  zoom double precision not null default 0,
  -- The answers. Never selectable by a client; only ever copied into a run row
  -- by the trusted function below.
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  label text not null,
  country text not null,
  primary key (utc_day, round_number),
  -- The same place must not appear twice within one day's challenge.
  unique (utc_day, group_id)
);

create table if not exists public.daily_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  utc_day date not null references public.daily_challenges (utc_day) on delete cascade,
  -- The run that carries the rounds, guesses and scoring (see solo_runs).
  run_id uuid not null references public.solo_runs (id) on delete cascade,
  kind text not null default 'official' check (kind in ('official', 'practice')),
  status text not null default 'active' check (status in ('active', 'complete', 'abandoned')),
  total_score int not null default 0 check (total_score >= 0),
  total_distance_km double precision not null default 0 check (total_distance_km >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Server-measured duration. Deliberately not a client-reported elapsed time:
  -- it is a leaderboard tiebreak, so it must not be forgeable.
  duration_ms bigint check (duration_ms is null or duration_ms >= 0)
);

-- THE one-official-attempt-per-day rule, as a constraint rather than a check in
-- application code. A partial unique index (not a plain UNIQUE) because practice
-- attempts are unlimited by design.
create unique index if not exists uq_daily_official_attempt
  on public.daily_attempts (user_id, utc_day)
  where kind = 'official';

create index if not exists idx_daily_attempts_day
  on public.daily_attempts (utc_day, status, total_score desc);
create index if not exists idx_daily_attempts_user
  on public.daily_attempts (user_id, utc_day desc);
create unique index if not exists uq_daily_attempts_run
  on public.daily_attempts (run_id);

-- ── RLS + privileges ────────────────────────────────────────────────────────
-- All three tables are deny-all for clients: daily_challenge_rounds holds the
-- answers, and daily_attempts is read through a sanitized leaderboard RPC that
-- never returns a user id.
alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_rounds enable row level security;
alter table public.daily_attempts enable row level security;

revoke all on public.daily_challenges from anon, authenticated;
revoke all on public.daily_challenge_rounds from anon, authenticated;
revoke all on public.daily_attempts from anon, authenticated;

-- Defence in depth: if a later migration ever grants SELECT on attempts, RLS
-- still confines a caller to their own rows.
drop policy if exists daily_attempts_select_own on public.daily_attempts;
create policy daily_attempts_select_own on public.daily_attempts
  for select using (user_id = auth.uid());

-- ── Generation ──────────────────────────────────────────────────────────────
-- Create today's challenge if it does not exist yet. Internal.
--
-- Transactional and race-safe: an advisory lock keyed on the day means two
-- players opening the app in the same second cannot generate two different
-- challenges, and the `on conflict do nothing` makes the loser of the race a
-- no-op rather than an error.
--
-- Refuses to generate a future day. This is the guarantee that no request —
-- however crafted — can cause tomorrow's answers to exist yet.
create or replace function public.roam_ensure_daily_challenge(p_day date default null)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := coalesce(p_day, public.roam_utc_day());
  v_difficulty text := 'normal';
  v_rounds int := 5;
  v_timer int;
  v_recent text[];
  v_selected jsonb;
  v_elem jsonb;
  i int;
begin
  if v_day > public.roam_utc_day() then
    raise exception 'A future Daily Challenge cannot be generated.';
  end if;

  if exists (select 1 from public.daily_challenges where utc_day = v_day) then
    return v_day;
  end if;

  -- Serialise generation for this specific day.
  perform pg_advisory_xact_lock(hashtext('roam_daily:' || v_day::text));

  -- Re-check after taking the lock (the classic double-checked pattern).
  if exists (select 1 from public.daily_challenges where utc_day = v_day) then
    return v_day;
  end if;

  v_timer := public.mp_difficulty_duration(v_difficulty);

  -- Diversity across *days*: avoid canonical groups used in the last two weeks
  -- of challenges, so consecutive dailies don't revisit the same places. A
  -- cooldown, not a hard exclusion — see roam_select_catalog_rounds.
  select coalesce(array_agg(distinct r.group_id), '{}') into v_recent
    from public.daily_challenge_rounds r
   where r.utc_day > v_day - interval '14 days';

  v_selected := public.roam_select_catalog_rounds(v_difficulty, v_rounds, '{}', v_recent);

  insert into public.daily_challenges (utc_day, difficulty, round_count, timer_seconds)
  values (v_day, v_difficulty, v_rounds, v_timer)
  on conflict (utc_day) do nothing;

  for i in 0 .. jsonb_array_length(v_selected) - 1 loop
    v_elem := v_selected -> i;
    insert into public.daily_challenge_rounds
      (utc_day, round_number, location_id, group_id, pano_id, heading, pitch, zoom,
       lat, lng, label, country)
    values (
      v_day, i + 1,
      v_elem ->> 'location_id',
      v_elem ->> 'group_id',
      v_elem ->> 'pano_id',
      coalesce((v_elem ->> 'heading')::double precision, 0),
      coalesce((v_elem ->> 'pitch')::double precision, 0),
      coalesce((v_elem ->> 'zoom')::double precision, 0),
      (v_elem ->> 'lat')::double precision,
      (v_elem ->> 'lng')::double precision,
      v_elem ->> 'label',
      v_elem ->> 'country'
    )
    on conflict (utc_day, round_number) do nothing;
  end loop;

  return v_day;
end;
$$;

-- ── Start / resume today's attempt ──────────────────────────────────────────
create or replace function public.roam_start_daily_v2(p_practice boolean default false)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
  v_challenge public.daily_challenges;
  v_existing public.daily_attempts;
  v_run public.solo_runs;
  v_rounds jsonb;
  v_kind text := case when p_practice then 'practice' else 'official' end;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.roam_check_rate_limit('roam_start_daily:burst', 10, 60);
  perform public.roam_check_rate_limit('roam_start_daily:sustained', 40, 3600);

  v_day := public.roam_ensure_daily_challenge();
  select * into v_challenge from public.daily_challenges where utc_day = v_day;

  -- One official attempt, ever, for this day.
  select * into v_existing from public.daily_attempts
    where user_id = v_uid and utc_day = v_day and kind = 'official'
    for update;

  if found and v_existing.status = 'complete' and not p_practice then
    -- Not an error the UI should treat as a failure: it is the normal state for
    -- the rest of the day. The client shows the result and the countdown.
    return json_build_object(
      'started', false,
      'reason', 'already_completed',
      'utc_day', v_day,
      'total_score', v_existing.total_score
    );
  end if;

  if found and v_existing.status = 'active' and not p_practice then
    -- Resume: return the run exactly as it stands, answers still hidden for
    -- every round that has not been guessed.
    return json_build_object(
      'started', true,
      'resumed', true,
      'utc_day', v_day,
      'run', public.roam_run_payload(v_existing.run_id)
    );
  end if;

  -- Practice is only allowed once the official attempt is finished. Without this
  -- a player could "practise" first and then take the official attempt already
  -- knowing every answer.
  if p_practice then
    if not found or v_existing.status <> 'complete' then
      raise exception 'Finish today’s official Daily Challenge first.';
    end if;
  end if;

  -- Abandon any unrelated active run so the one-active-run invariant holds.
  update public.solo_runs set status = 'abandoned', updated_at = now()
    where user_id = v_uid and status = 'active';

  insert into public.solo_runs
    (user_id, difficulty, total_rounds, round_duration_seconds, current_round,
     mode, server_selected)
  values (v_uid, v_challenge.difficulty, v_challenge.round_count,
          v_challenge.timer_seconds, 1,
          case when p_practice then 'practice' else 'daily' end, true)
  returning * into v_run;

  -- The same rounds, in the same order, for every player of this day.
  select jsonb_agg(jsonb_build_object(
           'location_id', r.location_id,
           'group_id', r.group_id,
           'pano_id', r.pano_id,
           'heading', r.heading,
           'pitch', r.pitch,
           'zoom', r.zoom,
           'lat', r.lat,
           'lng', r.lng,
           'label', r.label,
           'country', r.country
         ) order by r.round_number)
    into v_rounds
    from public.daily_challenge_rounds r
   where r.utc_day = v_day;

  perform public.roam_write_run_rounds(v_run.id, v_rounds, v_challenge.timer_seconds);

  insert into public.daily_attempts (user_id, utc_day, run_id, kind)
  values (v_uid, v_day, v_run.id, v_kind);

  return json_build_object(
    'started', true,
    'resumed', false,
    'utc_day', v_day,
    'practice', p_practice,
    'run', public.roam_run_payload(v_run.id)
  );
end;
$$;

-- ── Finalization hook ───────────────────────────────────────────────────────
-- Extension point called once, from inside roam_finalize_official_run_v2, after
-- a run is marked complete. Later migrations replace THIS function to add their
-- own modes rather than re-replacing the finalize function itself.
create or replace function public.roam_on_run_finalized(
  p_run_id uuid,
  p_uid uuid,
  p_mode text,
  p_total_score int,
  p_total_distance double precision
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Daily: stamp the attempt exactly once. `status = 'active'` in the WHERE
  -- clause is what makes a replayed finalize a no-op here too.
  update public.daily_attempts a
     set status = 'complete',
         total_score = p_total_score,
         total_distance_km = p_total_distance,
         completed_at = now(),
         duration_ms = greatest(0, (extract(epoch from (now() - a.started_at)) * 1000)::bigint)
   where a.run_id = p_run_id
     and a.user_id = p_uid
     and a.status = 'active';
end;
$$;

-- Replace the 0015 finalize so it calls the hook. Same signature, same
-- behaviour, plus the dispatch. (Introduced in this release; see the header.)
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
  v_eligible := (v_run.total_rounds = 5 and v_run.mode <> 'practice');

  update public.solo_runs
    set status = 'complete', total_score = v_total,
        finalized_at = now(), updated_at = now()
    where id = p_run_id;

  if v_run.mode in ('solo', 'practice') then
    insert into public.game_results
      (user_id, mode, difficulty, game_id, raw_score, max_score, round_count,
       placement, player_count, is_win, is_tie, completed_at, week_start, eligible)
    values
      (v_uid, 'solo', v_run.difficulty, p_run_id, v_total, v_max, v_run.total_rounds,
       1, 1, false, false, now(), public.roam_week_start(now()), v_eligible)
    on conflict (mode, game_id, user_id) do nothing;
  end if;

  perform public.roam_on_run_finalized(p_run_id, v_uid, v_run.mode, v_total, v_distance);

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

-- ── Status for the home card ────────────────────────────────────────────────
-- Everything the Daily card needs and nothing else: no rounds, no answers, no
-- other player's identity.
create or replace function public.roam_daily_status()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := public.roam_utc_day();
  v_challenge public.daily_challenges;
  v_attempt public.daily_attempts;
  v_prev public.daily_attempts;
  v_players int;
  v_rank int;
begin
  -- Deliberately does NOT generate the day's challenge: a read must not have a
  -- write side effect, and the home card renders fine before anyone has played.
  select * into v_challenge from public.daily_challenges where utc_day = v_day;

  if v_uid is not null then
    select * into v_attempt from public.daily_attempts
      where user_id = v_uid and utc_day = v_day and kind = 'official';
    select * into v_prev from public.daily_attempts
      where user_id = v_uid and utc_day = v_day - 1 and kind = 'official'
        and status = 'complete';
  end if;

  select count(*) into v_players from public.daily_attempts
   where utc_day = v_day and kind = 'official' and status = 'complete';

  if v_attempt.id is not null and v_attempt.status = 'complete' then
    select count(*) + 1 into v_rank
      from public.daily_attempts o
     where o.utc_day = v_day and o.kind = 'official' and o.status = 'complete'
       and (o.total_score, -o.total_distance_km, -o.duration_ms)
         > (v_attempt.total_score, -v_attempt.total_distance_km, -v_attempt.duration_ms);
  end if;

  return json_build_object(
    'utc_day', v_day,
    'server_now', now(),
    -- The next challenge always begins at midnight UTC. Returned so the client
    -- can count down against the server's clock rather than the device's.
    'next_day_at', ((v_day + 1)::timestamp at time zone 'UTC'),
    'round_count', coalesce(v_challenge.round_count, 5),
    'difficulty', coalesce(v_challenge.difficulty, 'normal'),
    'timer_seconds', coalesce(v_challenge.timer_seconds,
                              public.mp_difficulty_duration('normal')),
    'players_completed', v_players,
    'attempt', case when v_attempt.id is null then null else json_build_object(
      'status', v_attempt.status,
      'total_score', v_attempt.total_score,
      'total_distance_km', v_attempt.total_distance_km,
      'duration_ms', v_attempt.duration_ms,
      'completed_at', v_attempt.completed_at,
      'rank', v_rank,
      -- Rounds already played, so the card can say "3 of 5 done".
      'rounds_played', (
        select count(*) from public.solo_run_rounds
         where run_id = v_attempt.run_id and status = 'complete'
      )
    ) end,
    'previous', case when v_prev.id is null then null else json_build_object(
      'utc_day', v_prev.utc_day,
      'total_score', v_prev.total_score,
      'total_distance_km', v_prev.total_distance_km,
      'duration_ms', v_prev.duration_ms
    ) end
  );
end;
$$;

-- ── Leaderboard ─────────────────────────────────────────────────────────────
-- Sanitized: rank, display name, score, distance, duration, completion time,
-- and the caller's own position. NEVER a user id.
--
-- Tie-breaking, in order, and documented in the UI to match:
--   1. higher total score
--   2. lower total distance
--   3. shorter completion duration
--   4. earlier completion timestamp
-- A fifth, non-exposed tiebreak on user_id makes the order total and therefore
-- stable across calls — without it, two players identical on all four keys could
-- swap places between requests.
create or replace function public.roam_daily_leaderboard(
  p_day date default null,
  p_limit int default 50
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := coalesce(p_day, public.roam_utc_day());
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_entries json;
  v_self json;
begin
  -- No future days, ever: not even an empty response, so the shape of the
  -- answer cannot confirm anything about tomorrow.
  if v_day > public.roam_utc_day() then
    raise exception 'That Daily Challenge has not started yet.';
  end if;

  if v_uid is not null then
    perform public.roam_check_rate_limit('roam_daily_leaderboard', 120, 3600);
  end if;

  with ranked as (
    select a.user_id,
           a.total_score,
           a.total_distance_km,
           a.duration_ms,
           a.completed_at,
           coalesce(p.display_name, 'Player') as display_name,
           row_number() over (
             order by a.total_score desc,
                      a.total_distance_km asc,
                      a.duration_ms asc nulls last,
                      a.completed_at asc,
                      a.user_id asc
           ) as rnk
      from public.daily_attempts a
      left join public.player_profiles p on p.user_id = a.user_id
     where a.utc_day = v_day and a.kind = 'official' and a.status = 'complete'
  )
  select
    coalesce((
      select json_agg(json_build_object(
        'rank', rnk,
        'display_name', display_name,
        'total_score', total_score,
        'total_distance_km', total_distance_km,
        'duration_ms', duration_ms,
        'completed_at', completed_at,
        'is_self', (user_id = v_uid)
      ) order by rnk)
      from (select * from ranked order by rnk limit v_limit) top
    ), '[]'::json),
    (
      select json_build_object(
        'rank', rnk,
        'display_name', display_name,
        'total_score', total_score,
        'total_distance_km', total_distance_km,
        'duration_ms', duration_ms,
        'completed_at', completed_at,
        'is_self', true
      )
      from ranked where user_id = v_uid
    )
  into v_entries, v_self;

  return json_build_object(
    'utc_day', v_day,
    'entries', v_entries,
    'self', v_self,
    'server_now', now()
  );
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.roam_utc_day(timestamptz) from public, anon, authenticated;
revoke all on function public.roam_ensure_daily_challenge(date) from public, anon, authenticated;
revoke all on function public.roam_on_run_finalized(uuid, uuid, text, int, double precision)
  from public, anon, authenticated;
revoke all on function public.roam_start_daily_v2(boolean) from public, anon, authenticated;
revoke all on function public.roam_daily_status() from public, anon, authenticated;
revoke all on function public.roam_daily_leaderboard(date, int) from public, anon, authenticated;

-- Generation and the finalization hook stay server-only: the first writes the
-- answers, the second takes a caller-supplied identity.
grant execute on function public.roam_utc_day(timestamptz) to authenticated;
grant execute on function public.roam_start_daily_v2(boolean) to authenticated;
grant execute on function public.roam_daily_status() to authenticated;
grant execute on function public.roam_daily_leaderboard(date, int) to authenticated;

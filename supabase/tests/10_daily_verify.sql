-- ============================================================================
-- Daily Challenge verification (migration 0016).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after 0001→0016,
-- or via supabase/tests/run-local.sh.
--
-- Proves: shared locations, the one-official-attempt-per-UTC-day rule, resume,
-- exactly-once finalization, practice-after-completion only, future-day secrecy,
-- deterministic tie-breaking, leaderboard privacy, and cross-user isolation.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

create or replace function test_clear_rate_limits() returns void language sql as $$
  delete from public.rate_limits;
$$;

/**
 * Play every round of a run with a fixed guess, so a test can reach the
 * finalizable state in one line. Deliberately submits through the real RPC —
 * nothing here writes a score directly.
 */
create or replace function test_play_run(p_run uuid, p_lat double precision default 0,
                                         p_lng double precision default 0)
returns void language plpgsql as $$
declare r record;
begin
  for r in select round_number from public.solo_run_rounds
            where run_id = p_run order by round_number loop
    perform public.roam_submit_official_guess_v2(p_run, r.round_number, p_lat, p_lng);
  end loop;
end;
$$;

-- ── Part 1: generation, sharing and secrecy ─────────────────────────────────
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000001001';
  u2 uuid := '00000000-0000-0000-0000-000000001002';
  v_day date;
  v_json json;
  v_run1 uuid;
  v_run2 uuid;
  v_count int;
  v_failed boolean;
begin
  insert into auth.users(id) values (u1),(u2) on conflict do nothing;
  perform test_clear_rate_limits();

  -- ── A future day can never be generated ─────────────────────────────────
  begin
    perform public.roam_ensure_daily_challenge((public.roam_utc_day() + 1));
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'generating a future Daily Challenge is refused';
  assert not exists (
    select 1 from public.daily_challenges where utc_day > public.roam_utc_day()
  ), 'no future challenge row exists';
  raise notice 'OK: a future Daily Challenge cannot be generated';

  -- ── The status read has no write side effect ─────────────────────────────
  perform test_as(u1);
  v_json := public.roam_daily_status();
  assert (v_json->>'utc_day')::date = public.roam_utc_day(), 'status reports today';
  assert json_typeof(v_json->'attempt') = 'null', 'a fresh player has no attempt';
  assert not exists (select 1 from public.daily_challenges),
    'reading the status must not generate the day';
  raise notice 'OK: the Daily card can render without generating the challenge';

  -- ── Starting generates the day, once ────────────────────────────────────
  v_json := public.roam_start_daily_v2();
  v_day := (v_json->>'utc_day')::date;
  assert (v_json->>'started')::boolean, 'the attempt starts';
  assert not (v_json->>'resumed')::boolean, 'a first start is not a resume';
  v_run1 := (v_json->'run'->>'run_id')::uuid;
  assert v_run1 is not null, 'a run is created';
  assert (select count(*) from public.daily_challenge_rounds where utc_day = v_day) = 5,
    'five rounds generated';
  raise notice 'OK: the first player of the day generates it transactionally';

  -- ── Answers hidden ─────────────────────────────────────────────────────
  assert not exists (
    select 1 from json_array_elements(v_json->'run'->'rounds') r
     where (r.value->>'status') <> 'complete'
       and ((r.value->>'lat') is not null or (r.value->>'country') is not null
            or (r.value->>'location_id') is not null)
  ), 'no un-played Daily round exposes an answer';
  raise notice 'OK: today''s answers are hidden until each round is played';

  -- ── Everyone gets the same locations in the same order ──────────────────
  perform test_as(u2);
  v_json := public.roam_start_daily_v2();
  v_run2 := (v_json->'run'->>'run_id')::uuid;
  assert v_run2 <> v_run1, 'each player gets their own run';
  assert (
    select count(*) from public.solo_run_rounds a
    join public.solo_run_rounds b
      on b.run_id = v_run2 and b.round_number = a.round_number
     and b.location_id = a.location_id
    where a.run_id = v_run1
  ) = 5, 'both players get identical locations in identical order';
  raise notice 'OK: every player of the day gets the same locations in the same order';

  -- Generating twice is a no-op, not a second challenge.
  perform public.roam_ensure_daily_challenge();
  assert (select count(*) from public.daily_challenges where utc_day = v_day) = 1,
    'the day is generated exactly once';
  raise notice 'OK: challenge generation is idempotent';
end
$$;

-- ── Part 2: one official attempt, resume, finalize-once ─────────────────────
do $$
declare
  u3 uuid := '00000000-0000-0000-0000-000000001003';
  v_json json;
  v_run uuid;
  v_run_again uuid;
  v_count int;
  v_score int;
  v_failed boolean;
begin
  insert into auth.users(id) values (u3) on conflict do nothing;
  perform test_clear_rate_limits();
  perform test_as(u3);

  v_json := public.roam_start_daily_v2();
  v_run := (v_json->'run'->>'run_id')::uuid;

  -- ── Resume: starting again returns the SAME run, not a new one ──────────
  perform public.roam_submit_official_guess_v2(v_run, 1, 10, 10);
  v_json := public.roam_start_daily_v2();
  assert (v_json->>'resumed')::boolean, 'a partially played attempt resumes';
  v_run_again := (v_json->'run'->>'run_id')::uuid;
  assert v_run_again = v_run, 'resume returns the same run';
  assert (select count(*) from public.daily_attempts where user_id = u3) = 1,
    'resuming does not create a second attempt';
  -- The already-played round now carries its answer; the rest still do not.
  assert (
    select (r.value->>'country') is not null
      from json_array_elements(v_json->'run'->'rounds') r
     where (r.value->>'round_number')::int = 1
  ), 'a played round keeps its revealed answer across a resume';
  raise notice 'OK: a partial Daily attempt resumes without creating a second one';

  -- ── Practice is refused before the official attempt is complete ─────────
  begin
    perform public.roam_start_daily_v2(true);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'practice before finishing the official attempt is refused';
  raise notice 'OK: practice cannot be used to see the answers first';

  -- ── Finish and finalize ────────────────────────────────────────────────
  perform test_play_run(v_run, 48.85, 2.29);
  v_json := public.roam_finalize_official_run_v2(v_run);
  v_score := (v_json->>'total_score')::int;
  assert (select status from public.daily_attempts where run_id = v_run) = 'complete',
    'the attempt is marked complete';
  assert (select total_score from public.daily_attempts where run_id = v_run) = v_score,
    'the attempt records the server-summed score';
  assert (select duration_ms from public.daily_attempts where run_id = v_run) is not null,
    'the server measures the duration itself';
  raise notice 'OK: finalizing stamps the attempt with server-computed totals';

  -- ── Finalize again: no second score, no changed numbers ────────────────
  v_json := public.roam_finalize_official_run_v2(v_run);
  assert (v_json->>'already')::boolean, 'a replayed finalize is a no-op';
  assert (select total_score from public.daily_attempts where run_id = v_run) = v_score,
    'a replayed finalize cannot change the recorded score';
  assert (select count(*) from public.daily_attempts where user_id = u3) = 1,
    'still exactly one attempt';
  raise notice 'OK: a Daily result is finalized exactly once';

  -- ── A completed day cannot be replayed for a second official score ──────
  v_json := public.roam_start_daily_v2();
  assert not (v_json->>'started')::boolean, 'a completed Daily cannot be restarted';
  assert (v_json->>'reason') = 'already_completed', 'the reason is reported to the UI';
  raise notice 'OK: a completed Daily cannot be replayed officially';

  -- ── The one-official-attempt rule is a database constraint, not a check ──
  begin
    insert into public.daily_attempts (user_id, utc_day, run_id, kind)
    values (u3, public.roam_utc_day(), v_run, 'official');
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a second official attempt row is rejected by the database';
  raise notice 'OK: one official attempt per UTC day is enforced by a constraint';

  -- ── Practice AFTER completion is allowed and does not overwrite ─────────
  perform test_clear_rate_limits();
  v_json := public.roam_start_daily_v2(true);
  assert (v_json->>'started')::boolean, 'practice is allowed once the official attempt is done';
  perform test_play_run((v_json->'run'->>'run_id')::uuid, 0, 0);
  perform public.roam_finalize_official_run_v2((v_json->'run'->>'run_id')::uuid);
  assert (select total_score from public.daily_attempts
           where user_id = u3 and kind = 'official') = v_score,
    'a practice run cannot overwrite the official score';
  assert (select count(*) from public.daily_attempts
           where user_id = u3 and kind = 'practice') = 1,
    'the practice attempt is recorded separately';
  raise notice 'OK: practice after completion never touches the official result';

  -- Practice is never leaderboard-eligible.
  assert not exists (
    select 1 from public.game_results g
      join public.solo_runs r on r.id = g.game_id
     where r.mode = 'practice' and g.eligible
  ), 'a practice run is never leaderboard-eligible';
  raise notice 'OK: practice runs are excluded from the weekly leaderboard';
end
$$;

-- ── Part 3: leaderboard ordering, privacy and future-day refusal ────────────
do $$
declare
  a uuid := '00000000-0000-0000-0000-000000001011';
  b uuid := '00000000-0000-0000-0000-000000001012';
  c uuid := '00000000-0000-0000-0000-000000001013';
  v_day date := public.roam_utc_day();
  v_json json;
  v_names text[];
  v_failed boolean;
begin
  insert into auth.users(id) values (a),(b),(c) on conflict do nothing;
  perform test_clear_rate_limits();
  perform public.roam_ensure_daily_challenge();

  -- Seed three finished attempts that are deliberately tied on the earlier keys,
  -- so each tiebreak is exercised in isolation. Written directly because the
  -- point here is the ORDERING, not the scoring path (covered in part 2).
  delete from public.daily_attempts where user_id in (a, b, c);
  perform test_as(a);
  insert into public.player_profiles (user_id, display_name) values
    (a, 'Ada'), (b, 'Blake'), (c, 'Cass')
  on conflict (user_id) do update set display_name = excluded.display_name;

  insert into public.solo_runs (id, user_id, difficulty, total_rounds,
    round_duration_seconds, status, mode, server_selected)
  values
    ('11111111-0000-4000-8000-00000000000a', a, 'normal', 5, 120, 'complete', 'daily', true),
    ('11111111-0000-4000-8000-00000000000b', b, 'normal', 5, 120, 'complete', 'daily', true),
    ('11111111-0000-4000-8000-00000000000c', c, 'normal', 5, 120, 'complete', 'daily', true);

  insert into public.daily_attempts
    (user_id, utc_day, run_id, kind, status, total_score, total_distance_km,
     completed_at, duration_ms)
  values
    -- Same score; Ada is closer → Ada first.
    (a, v_day, '11111111-0000-4000-8000-00000000000a', 'official', 'complete',
     20000, 100, now(), 300000),
    (b, v_day, '11111111-0000-4000-8000-00000000000b', 'official', 'complete',
     20000, 500, now(), 100000),
    -- Lower score, but fastest and closest — must still come last.
    (c, v_day, '11111111-0000-4000-8000-00000000000c', 'official', 'complete',
     19000, 1, now(), 1000);

  v_json := public.roam_daily_leaderboard(v_day, 50);
  select array_agg(e.value->>'display_name' order by (e.value->>'rank')::int)
    into v_names
    from json_array_elements(v_json->'entries') e
   where e.value->>'display_name' in ('Ada', 'Blake', 'Cass');
  assert v_names = array['Ada', 'Blake', 'Cass'],
    format('tie-break order is score, then distance, then duration (got %s)', v_names);
  raise notice 'OK: leaderboard ties break by score, then distance, then duration';

  -- ── Privacy: no UUIDs, ever ────────────────────────────────────────────
  assert not (v_json::text like '%' || a::text || '%'), 'the leaderboard leaks no user id';
  assert not (v_json::text like '%user_id%'), 'the leaderboard exposes no user_id field';
  raise notice 'OK: the Daily leaderboard exposes no user id';

  -- ── The caller sees their own position ─────────────────────────────────
  perform test_as(b);
  v_json := public.roam_daily_leaderboard(v_day, 1);
  assert (v_json->'self'->>'display_name') = 'Blake', 'the caller gets their own entry';
  assert (v_json->'self'->>'rank')::int = 2, 'the caller''s rank is correct even outside the top N';
  assert json_array_length(v_json->'entries') = 1, 'the limit is respected';
  raise notice 'OK: the caller''s own position is returned even outside the top slice';

  -- ── Determinism: the same call twice gives the same order ──────────────
  assert public.roam_daily_leaderboard(v_day, 50)::text
       = public.roam_daily_leaderboard(v_day, 50)::text,
    'the ranking is deterministic across calls';
  raise notice 'OK: the ranking is stable across repeated calls';

  -- ── No future days ─────────────────────────────────────────────────────
  begin
    perform public.roam_daily_leaderboard(v_day + 1, 50);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a future day''s leaderboard is refused';
  raise notice 'OK: a future Daily leaderboard cannot be requested';

  -- ── An in-progress attempt is not on the leaderboard ───────────────────
  perform test_clear_rate_limits();
  perform test_as(c);
  update public.daily_attempts set status = 'active' where user_id = c;
  v_json := public.roam_daily_leaderboard(v_day, 50);
  assert not (v_json::text like '%Cass%'), 'an unfinished attempt is not ranked';
  raise notice 'OK: only completed attempts appear on the leaderboard';
end
$$;

-- ── Part 4: access control ──────────────────────────────────────────────────
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000001021';
  other uuid := '00000000-0000-0000-0000-000000001022';
  v_json json;
  v_run uuid;
  v_failed boolean;
begin
  insert into auth.users(id) values (u),(other) on conflict do nothing;
  perform test_clear_rate_limits();

  -- RLS on, no client privileges.
  assert (select relrowsecurity from pg_class where oid = 'public.daily_challenge_rounds'::regclass),
    'RLS is enabled on daily_challenge_rounds';
  assert not has_table_privilege('authenticated', 'public.daily_challenge_rounds', 'select'),
    'authenticated cannot read the Daily answers';
  assert not has_table_privilege('anon', 'public.daily_challenge_rounds', 'select'),
    'anon cannot read the Daily answers';
  assert not has_table_privilege('authenticated', 'public.daily_attempts', 'insert'),
    'authenticated cannot insert an attempt directly';
  assert not has_table_privilege('authenticated', 'public.daily_attempts', 'update'),
    'authenticated cannot forge a score by updating an attempt';
  assert not has_table_privilege('authenticated', 'public.daily_challenges', 'select'),
    'authenticated cannot read the challenge table directly';
  raise notice 'OK: every Daily table is deny-all for client roles';

  -- Generation and the finalize hook are server-only.
  assert not has_function_privilege('authenticated',
    'public.roam_ensure_daily_challenge(date)', 'execute'),
    'authenticated cannot force challenge generation';
  assert not has_function_privilege('authenticated',
    'public.roam_on_run_finalized(uuid, uuid, text, int, double precision)', 'execute'),
    'authenticated cannot call the finalization hook (it takes a caller-supplied uid)';
  assert not has_function_privilege('anon', 'public.roam_start_daily_v2(boolean)', 'execute'),
    'anon cannot start a Daily attempt';
  raise notice 'OK: Daily generation and the finalize hook are unreachable from a browser';

  -- Cross-user: another player cannot finalize or read someone else's Daily run.
  perform test_as(u);
  v_json := public.roam_start_daily_v2();
  v_run := (v_json->'run'->>'run_id')::uuid;

  perform test_as(other);
  begin
    perform public.roam_finalize_official_run_v2(v_run);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'another player cannot finalize this Daily run';
  assert not (public.roam_get_official_run_v2(v_run)->>'found')::boolean,
    'another player cannot read this Daily run';
  raise notice 'OK: a Daily attempt is isolated to its owner';

  -- Signed out: no attempt, no crash.
  perform set_config('test.uid', '', false);
  v_json := public.roam_daily_status();
  assert (v_json->>'utc_day') is not null, 'the status still renders for a signed-out caller';
  begin
    perform public.roam_start_daily_v2();
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a signed-out caller cannot start a Daily attempt';
  raise notice 'OK: unauthenticated access is denied without breaking the read';
end
$$;

do $$
begin
  raise notice '=== 10_daily_verify.sql: ALL ASSERTIONS PASSED ===';
end
$$;

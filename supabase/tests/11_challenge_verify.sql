-- ============================================================================
-- Shared challenge verification (migration 0017).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after 0001→0017,
-- or via supabase/tests/run-local.sh.
--
-- Proves: server-chosen locations, shared order, one official attempt each,
-- resume, exactly-once finalization, expiry, title sanitisation, code-shape
-- validation, enumeration resistance, unlistability, leaderboard privacy and
-- rate limiting.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

create or replace function test_clear_rate_limits() returns void language sql as $$
  delete from public.rate_limits;
$$;

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

-- ── Part 1: creation ────────────────────────────────────────────────────────
do $$
declare
  creator uuid := '00000000-0000-0000-0000-000000001101';
  v_json json;
  v_code text;
  v_failed boolean;
begin
  insert into auth.users(id) values (creator) on conflict do nothing;
  perform test_clear_rate_limits();
  perform test_as(creator);

  v_json := public.roam_create_challenge_v2('normal', 5, null, '  My   <b>Trip</b>  ', 168);
  v_code := v_json->>'code';

  assert v_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$',
    format('a 10-character unambiguous code is issued (got %s)', v_code);
  raise notice 'OK: a challenge gets a 10-character unambiguous code (%)', v_code;

  -- Title sanitisation: angle brackets stripped, whitespace collapsed, trimmed.
  assert (v_json->>'title') = 'My Trip',
    format('the title is sanitised server-side (got "%s")', v_json->>'title');
  assert public.roam_clean_challenge_title(repeat('x', 200)) = repeat('x', 60),
    'an over-long title is clamped';
  assert public.roam_clean_challenge_title(e'a\tb\nc') = 'a b c',
    'control characters and newlines are collapsed';
  raise notice 'OK: the challenge title is sanitised and length-limited';

  -- The server chose the rounds, and it chose distinct places.
  assert (select count(*) from public.shared_challenge_rounds where code = v_code) = 5,
    'five rounds stored';
  assert (select count(distinct group_id) from public.shared_challenge_rounds
           where code = v_code) = 5,
    'no canonical place repeats inside a challenge';
  assert (select count(*) from public.shared_challenge_rounds r
           join public.game_catalog c on c.location_id = r.location_id
          where r.code = v_code) = 5,
    'every round came from the server catalog';
  raise notice 'OK: the server chooses the locations; the creator supplies none';

  -- The response tells the creator nothing about the answers.
  assert not (v_json::text like '%lat%'), 'the create response contains no coordinate';
  assert not (v_json::text like '%pano%'), 'the create response contains no panorama id';
  raise notice 'OK: the creator does not learn their own challenge''s answers';

  -- ── Bounds ──────────────────────────────────────────────────────────────
  perform test_clear_rate_limits();
  begin
    perform public.roam_create_challenge_v2('normal', 7, null, '', 168);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a round count other than 5 or 10 is rejected';

  begin
    perform public.roam_create_challenge_v2('normal', 5, 5, '', 168);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an absurd round timer is rejected';

  begin
    perform public.roam_create_challenge_v2('normal', 5, null, '', 100000);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an unbounded expiry is rejected';

  begin
    perform public.roam_create_challenge_v2('impossible', 5, null, '', 168);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an unknown difficulty is rejected';
  raise notice 'OK: every creator-supplied option is bounded';

  -- Expiry is always set — a challenge cannot be immortal by omission.
  assert (select expires_at from public.shared_challenges where code = v_code) > now(),
    'a challenge has a future expiry';
  raise notice 'OK: every challenge has a bounded lifetime';

  -- ── Rate limiting ───────────────────────────────────────────────────────
  perform test_clear_rate_limits();
  begin
    -- Burst limit is 3/minute.
    perform public.roam_create_challenge_v2('normal', 5, null, '', 24);
    perform public.roam_create_challenge_v2('normal', 5, null, '', 24);
    perform public.roam_create_challenge_v2('normal', 5, null, '', 24);
    perform public.roam_create_challenge_v2('normal', 5, null, '', 24);
    v_failed := false;
  exception when others then
    v_failed := sqlerrm like 'RATE_LIMITED:%';
  end;
  assert v_failed, 'challenge creation is rate limited';
  raise notice 'OK: challenge creation is rate limited';
end
$$;

-- ── Part 2: playing, sharing and one-attempt-each ───────────────────────────
do $$
declare
  creator uuid := '00000000-0000-0000-0000-000000001111';
  p1 uuid := '00000000-0000-0000-0000-000000001112';
  p2 uuid := '00000000-0000-0000-0000-000000001113';
  v_code text;
  v_json json;
  v_run1 uuid;
  v_run2 uuid;
  v_score int;
  v_failed boolean;
begin
  insert into auth.users(id) values (creator),(p1),(p2) on conflict do nothing;
  perform test_clear_rate_limits();
  perform test_as(creator);
  v_code := public.roam_create_challenge_v2('normal', 5, 90, 'Shared five', 24)->>'code';

  -- ── Lookup exposes configuration, never rounds ──────────────────────────
  perform test_as(p1);
  v_json := public.roam_get_challenge_v2(v_code);
  assert (v_json->>'playable')::boolean, 'the challenge is playable';
  assert (v_json->>'title') = 'Shared five', 'the title is returned';
  assert (v_json->>'round_count')::int = 5, 'the round count is returned';
  assert (v_json->>'creator_name') is not null, 'the creator display name is returned';
  assert not (v_json::text like '%lat%'), 'the lookup leaks no coordinate';
  assert not (v_json::text like '%pano%'), 'the lookup leaks no panorama id';
  assert not (v_json::text like '%' || creator::text || '%'), 'the lookup leaks no user id';
  raise notice 'OK: a challenge lookup returns configuration only';

  -- ── Everyone gets the same locations in the same order ──────────────────
  v_run1 := (public.roam_start_challenge_v2(v_code)->'run'->>'run_id')::uuid;
  perform test_as(p2);
  v_run2 := (public.roam_start_challenge_v2(v_code)->'run'->>'run_id')::uuid;
  assert (
    select count(*) from public.solo_run_rounds a
    join public.solo_run_rounds b
      on b.run_id = v_run2 and b.round_number = a.round_number
     and b.location_id = a.location_id
    where a.run_id = v_run1
  ) = 5, 'both players get identical locations in identical order';
  raise notice 'OK: every player of a challenge gets the same locations in the same order';

  -- ── Answers hidden ─────────────────────────────────────────────────────
  assert not exists (
    select 1 from json_array_elements(public.roam_get_official_run_v2(v_run2)->'rounds') r
     where (r.value->>'status') <> 'complete' and (r.value->>'lat') is not null
  ), 'no un-played challenge round exposes an answer';
  raise notice 'OK: challenge answers are hidden until each round is played';

  -- ── Resume ─────────────────────────────────────────────────────────────
  perform public.roam_submit_official_guess_v2(v_run2, 1, 10, 10);
  v_json := public.roam_start_challenge_v2(v_code);
  assert (v_json->>'resumed')::boolean, 'a partial attempt resumes';
  assert (v_json->'run'->>'run_id')::uuid = v_run2, 'resume returns the same run';
  assert (select count(*) from public.shared_challenge_attempts
           where code = v_code and user_id = p2) = 1,
    'resuming does not create a second attempt';
  raise notice 'OK: a partial challenge attempt resumes without creating a second one';

  -- ── Finish, finalize once ──────────────────────────────────────────────
  perform test_play_run(v_run2, 48.85, 2.29);
  v_score := (public.roam_finalize_official_run_v2(v_run2)->>'total_score')::int;
  assert (select status from public.shared_challenge_attempts where run_id = v_run2) = 'complete',
    'the attempt is completed';
  assert (select total_score from public.shared_challenge_attempts where run_id = v_run2) = v_score,
    'the attempt records the server-summed score';
  assert (select duration_ms from public.shared_challenge_attempts where run_id = v_run2) is not null,
    'the server measures the duration';

  perform public.roam_finalize_official_run_v2(v_run2);
  assert (select total_score from public.shared_challenge_attempts where run_id = v_run2) = v_score,
    'a replayed finalize cannot change the score';
  raise notice 'OK: a challenge result is finalized exactly once';

  -- ── One official attempt each ──────────────────────────────────────────
  v_json := public.roam_start_challenge_v2(v_code);
  assert not (v_json->>'started')::boolean, 'a finished challenge cannot be replayed';
  assert (v_json->>'reason') = 'already_completed', 'the reason is reported';

  begin
    insert into public.shared_challenge_attempts (code, user_id, run_id)
    values (v_code, p2, v_run2);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a second attempt row is rejected by the database';
  raise notice 'OK: one official attempt per player per challenge, enforced by a constraint';

  -- ── The creator plays like anyone else ─────────────────────────────────
  perform test_clear_rate_limits();
  perform test_as(creator);
  v_json := public.roam_start_challenge_v2(v_code);
  assert (v_json->>'started')::boolean, 'the creator can play their own challenge';
  assert not exists (
    select 1 from json_array_elements(v_json->'run'->'rounds') r
     where (r.value->>'status') <> 'complete' and (r.value->>'country') is not null
  ), 'the creator does not get the answers either';
  raise notice 'OK: the creator has no informational advantage in their own challenge';
end
$$;

-- ── Part 3: expiry, bad codes and enumeration ───────────────────────────────
do $$
declare
  creator uuid := '00000000-0000-0000-0000-000000001121';
  player uuid := '00000000-0000-0000-0000-000000001122';
  v_code text;
  v_json json;
  v_failed boolean;
begin
  insert into auth.users(id) values (creator),(player) on conflict do nothing;
  perform test_clear_rate_limits();
  perform test_as(creator);
  v_code := public.roam_create_challenge_v2('easy', 10, null, 'Expiring', 1)->>'code';

  -- Force it into the past.
  update public.shared_challenges set expires_at = now() - interval '1 minute'
   where code = v_code;

  perform test_as(player);
  v_json := public.roam_get_challenge_v2(v_code);
  assert not (v_json->>'playable')::boolean, 'an expired challenge is not playable';
  assert (v_json->>'reason') = 'expired', 'expiry is reported distinctly to a code holder';
  begin
    perform public.roam_start_challenge_v2(v_code);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an expired challenge cannot be started';
  raise notice 'OK: an expired challenge is refused with a clear reason';

  -- ── Unknown and malformed codes are indistinguishable ──────────────────
  v_json := public.roam_get_challenge_v2('ZZZZZZZZZZ');
  assert (v_json->>'reason') = 'not_found', 'an unknown well-formed code is not_found';
  assert json_typeof(v_json->'title') = 'null' or (v_json->'title') is null,
    'an unknown code reveals no title';

  assert (public.roam_get_challenge_v2('nope')->>'reason') = 'not_found',
    'a malformed code is not_found';
  assert (public.roam_get_challenge_v2('')->>'reason') = 'not_found',
    'an empty code is not_found';
  assert (public.roam_get_challenge_v2(null)->>'reason') = 'not_found',
    'a null code is not_found';
  -- Ambiguous characters are outside the alphabet, so a typo'd code cannot
  -- accidentally resolve to a different challenge.
  assert (public.roam_get_challenge_v2('OOOOOOOOOO')->>'reason') = 'not_found',
    'letters outside the alphabet never resolve';
  raise notice 'OK: unknown, malformed and out-of-alphabet codes are indistinguishable';

  -- ── Enumeration is rate limited ────────────────────────────────────────
  perform test_clear_rate_limits();
  begin
    for i in 1..130 loop
      perform public.roam_get_challenge_v2('ZZZZZZZZZZ');
    end loop;
    v_failed := false;
  exception when others then
    v_failed := sqlerrm like 'RATE_LIMITED:%';
  end;
  assert v_failed, 'code lookups are rate limited, so guessing is not free';
  raise notice 'OK: code lookup is rate limited against enumeration';

  -- ── Unlisted really means unlisted ─────────────────────────────────────
  -- There must be no way to enumerate challenges: no client-callable function
  -- returns more than one challenge, and the table itself is unreadable.
  assert not has_table_privilege('authenticated', 'public.shared_challenges', 'select'),
    'authenticated cannot read the challenge table';
  assert not has_table_privilege('anon', 'public.shared_challenges', 'select'),
    'anon cannot read the challenge table';
  assert not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like '%challenge%'
       and p.proname like '%list%'
       and has_function_privilege('authenticated', p.oid, 'execute')
  ), 'there is no client-callable challenge listing function';
  raise notice 'OK: challenges are unlisted — no searchable list exists';
end
$$;

-- ── Part 4: leaderboard, isolation and access control ───────────────────────
do $$
declare
  creator uuid := '00000000-0000-0000-0000-000000001131';
  a uuid := '00000000-0000-0000-0000-000000001132';
  b uuid := '00000000-0000-0000-0000-000000001133';
  v_code text;
  v_json json;
  v_run uuid;
  v_names text[];
  v_failed boolean;
begin
  insert into auth.users(id) values (creator),(a),(b) on conflict do nothing;
  insert into public.player_profiles (user_id, display_name) values
    (creator, 'Maker'), (a, 'Ann'), (b, 'Bob')
  on conflict (user_id) do update set display_name = excluded.display_name;
  perform test_clear_rate_limits();

  perform test_as(creator);
  v_code := public.roam_create_challenge_v2('normal', 5, null, 'Board test', 24)->>'code';

  -- A brand-new challenge has an empty board, not an error.
  v_json := public.roam_challenge_leaderboard(v_code, 50);
  assert json_array_length(v_json->'entries') = 0, 'a new challenge has an empty board';
  -- …and so does a code that does not exist, so the two are indistinguishable.
  assert json_array_length(public.roam_challenge_leaderboard('ZZZZZZZZZZ', 50)->'entries') = 0,
    'an unknown code returns an empty board rather than an error';
  raise notice 'OK: an empty board and an unknown code look identical';

  -- Two players finish with the same score; the closer one must rank first.
  perform test_as(a);
  v_run := (public.roam_start_challenge_v2(v_code)->'run'->>'run_id')::uuid;
  perform test_play_run(v_run, 0, 0);
  perform public.roam_finalize_official_run_v2(v_run);
  update public.shared_challenge_attempts
     set total_score = 20000, total_distance_km = 100 where user_id = a and code = v_code;

  perform test_as(b);
  v_run := (public.roam_start_challenge_v2(v_code)->'run'->>'run_id')::uuid;
  perform test_play_run(v_run, 0, 0);
  perform public.roam_finalize_official_run_v2(v_run);
  update public.shared_challenge_attempts
     set total_score = 20000, total_distance_km = 900 where user_id = b and code = v_code;

  v_json := public.roam_challenge_leaderboard(v_code, 50);
  select array_agg(e.value->>'display_name' order by (e.value->>'rank')::int)
    into v_names from json_array_elements(v_json->'entries') e;
  assert v_names = array['Ann', 'Bob'],
    format('the closer player ranks first on equal score (got %s)', v_names);
  assert not (v_json::text like '%' || a::text || '%'), 'the board leaks no user id';
  assert (v_json->'self'->>'display_name') = 'Bob', 'the caller sees their own row';
  raise notice 'OK: the challenge board applies the documented tie rules and hides identities';

  -- ── Cross-user isolation ───────────────────────────────────────────────
  select run_id into v_run from public.shared_challenge_attempts
   where code = v_code and user_id = a;
  perform test_as(b);
  begin
    perform public.roam_submit_official_guess_v2(v_run, 1, 0, 0);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'another player cannot submit into this attempt';
  assert not (public.roam_get_official_run_v2(v_run)->>'found')::boolean,
    'another player cannot read this attempt';
  raise notice 'OK: a challenge attempt is isolated to its owner';

  -- ── Table and function privileges ──────────────────────────────────────
  assert (select relrowsecurity from pg_class
           where oid = 'public.shared_challenge_rounds'::regclass),
    'RLS is enabled on shared_challenge_rounds';
  assert not has_table_privilege('authenticated', 'public.shared_challenge_rounds', 'select'),
    'authenticated cannot read challenge answers';
  assert not has_table_privilege('authenticated', 'public.shared_challenge_attempts', 'update'),
    'authenticated cannot forge a challenge score';
  assert not has_table_privilege('authenticated', 'public.shared_challenges', 'insert'),
    'authenticated cannot insert a challenge directly';
  assert not has_function_privilege('anon', 'public.roam_create_challenge_v2(text, int, int, text, int)',
    'execute'), 'anon cannot create a challenge';
  assert has_function_privilege('authenticated',
    'public.roam_get_challenge_v2(text)', 'execute'),
    'a signed-in player can look a challenge up';
  raise notice 'OK: challenge tables are deny-all and the RPCs are correctly granted';

  -- ── Signed out ─────────────────────────────────────────────────────────
  perform set_config('test.uid', '', false);
  begin
    perform public.roam_create_challenge_v2('normal', 5, null, '', 24);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a signed-out caller cannot create a challenge';
  begin
    perform public.roam_start_challenge_v2(v_code);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a signed-out caller cannot start an attempt';
  raise notice 'OK: unauthenticated challenge writes are denied';
end
$$;

do $$
begin
  raise notice '=== 11_challenge_verify.sql: ALL ASSERTIONS PASSED ===';
end
$$;

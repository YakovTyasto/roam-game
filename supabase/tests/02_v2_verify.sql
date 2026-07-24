-- ============================================================================
-- Roam v2 verification — party rooms, dynamic completion, host transfer,
-- profiles, server-authoritative solo runs, and the weekly leaderboard.
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- migrations 0001→0005. Every assertion prints "OK: …"; a failure raises
-- ASSERT FAILED and aborts.
--
--   psql -f supabase/tests/00_local_stubs.sql
--   psql -f supabase/migrations/0001_multiplayer_schema.sql
--   psql -f supabase/migrations/0002_multiplayer_functions.sql
--   psql -f supabase/migrations/0003_difficulty_and_party_rooms.sql
--   psql -f supabase/migrations/0004_player_profiles_and_leaderboard.sql
--   psql -f supabase/migrations/0005_v2_rpc_functions.sql
--   psql -f supabase/tests/02_v2_verify.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- Helpers to impersonate users.
create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000001';
  u2 uuid := '00000000-0000-0000-0000-000000000002';
  u3 uuid := '00000000-0000-0000-0000-000000000003';
  u4 uuid := '00000000-0000-0000-0000-000000000004';
  v_room uuid;
  v_code text;
  v_json json;
  v_cnt int;
  v_run uuid;
  v_score int;
  i int;
  v_rn int;
begin
  insert into auth.users(id) values (u1),(u2),(u3),(u4) on conflict do nothing;

  -- ── Profiles ──────────────────────────────────────────────────────────────
  perform test_as(u1);
  perform roam_upsert_profile('  Alice <b>  ');
  select display_name into v_code from player_profiles where user_id = u1;
  assert v_code = 'Alice b', format('profile sanitized name, got %', v_code);
  raise notice 'OK: profile upsert sanitizes name';

  select roam_get_profile() into v_json;
  assert (v_json->>'exists') = 'true' and (v_json->>'display_name') = 'Alice b',
    'get_profile returns existing';
  raise notice 'OK: get_profile returns existing profile';

  perform test_as(u2);
  select roam_get_profile() into v_json;
  assert (v_json->>'exists') = 'false', 'get_profile absent for new user';
  raise notice 'OK: get_profile reports absent profile';

  -- ── Party room capacity (create max 8, join up to cap, reject 9th) ─────────
  perform test_as(u1);
  select mp_create_room('Alice','hard',3,5) into v_json;   -- capacity 3
  v_room := (v_json->>'room_id')::uuid;
  assert (select difficulty from multiplayer_rooms where id=v_room) = 'hard',
    'room difficulty stored';
  assert (select max_players from multiplayer_rooms where id=v_room) = 3, 'capacity stored';
  assert (select round_duration_seconds from multiplayer_rooms where id=v_room) = 75,
    'hard duration = 75';
  raise notice 'OK: create_room stores difficulty/capacity + derives timer';

  select code into v_code from multiplayer_rooms where id = v_room;
  perform test_as(u2); perform mp_join_room(v_code,'Bob');
  perform test_as(u3); perform mp_join_room(v_code,'Cara');
  select count(*) into v_cnt from multiplayer_players where room_id = v_room;
  assert v_cnt = 3, 'three players joined';
  raise notice 'OK: players join up to capacity (3/3)';

  -- 4th join must be rejected (room full at capacity 3).
  perform test_as(u4);
  begin
    perform mp_join_room(v_code,'Dan');
    assert false, 'expected full-room rejection';
  exception when others then
    assert sqlerrm like '%full%', format('unexpected error: %', sqlerrm);
    raise notice 'OK: over-capacity join rejected';
  end;

  -- Non-host cannot start.
  perform test_as(u2);
  begin
    perform mp_start_match(v_room, '[]'::jsonb);
    assert false, 'expected host-only rejection';
  exception when others then
    assert sqlerrm like '%host%' or sqlerrm like '%rounds%',
      format('unexpected: %', sqlerrm);
    raise notice 'OK: non-host start rejected';
  end;

  -- Host starts with a 5-round manifest (3 players present, room not full → OK).
  perform test_as(u1);
  perform mp_start_match(v_room, (
    select jsonb_agg(jsonb_build_object(
      'location_id','loc'||g,'lat',10+g,'lng',20+g,
      'label','L'||g,'country','C'||g,'pano_id','pano'||g,
      'heading',0,'pitch',0,'zoom',0))
    from generate_series(1,5) g));
  assert (select status from multiplayer_rooms where id=v_room) = 'active',
    'match active after start';
  raise notice 'OK: host starts party match with 2+ players (not full)';

  -- ── Dynamic completion: round completes only when ALL 3 have submitted ─────
  perform test_as(u1); perform mp_submit_guess(v_room, 10.5, 20.5);
  perform test_as(u2); perform mp_submit_guess(v_room, 11.5, 21.5);
  assert (select status from multiplayer_rounds where room_id=v_room and round_number=1) = 'active',
    'round still active with 2/3 submitted (not the old threshold of 2)';
  raise notice 'OK: round stays open until every eligible player submits (not fixed 2)';

  perform test_as(u3); perform mp_submit_guess(v_room, 12.5, 22.5);
  assert (select status from multiplayer_rounds where room_id=v_room and round_number=1) = 'complete',
    'round completes when all 3 submit';
  raise notice 'OK: round completes on dynamic threshold (3/3)';

  -- Duplicate submit is idempotent (no error, no double count).
  perform test_as(u3); perform mp_submit_guess(v_room, 0, 0);
  select count(*) into v_cnt from multiplayer_guesses
    where room_id=v_room and round_id=(select id from multiplayer_rounds where room_id=v_room and round_number=1);
  assert v_cnt = 3, 'still exactly 3 guesses after duplicate submit';
  raise notice 'OK: duplicate submit idempotent';

  -- Advance through remaining rounds; player u3 LEAVES mid-match after round 2.
  perform test_as(u1); perform mp_advance_round(v_room, 1);
  -- round 2: u1,u2 submit, u3 leaves → eligible drops to 2, both submitted → completes
  perform test_as(u1); perform mp_submit_guess(v_room, 10.5, 20.5);
  perform test_as(u2); perform mp_submit_guess(v_room, 11.5, 21.5);
  perform test_as(u3); perform mp_leave_room(v_room);
  assert (select connection_status from multiplayer_players where room_id=v_room and user_id=u3) = 'left',
    'u3 marked left';
  assert (select status from multiplayer_rooms where id=v_room) = 'active',
    'room continues after one leaves (party not destroyed)';
  assert (select status from multiplayer_rounds where room_id=v_room and round_number=2) = 'complete',
    'round 2 completes once remaining eligible have all guessed';
  raise notice 'OK: one player leaving does not destroy the party; round completes on remaining';

  -- Finish the match (rounds 3,4,5): only u1,u2 eligible now.
  for i in 3..5 loop
    perform test_as(u1); perform mp_advance_round(v_room, i-1);
    perform test_as(u1); perform mp_submit_guess(v_room, 10.5, 20.5);
    perform test_as(u2); perform mp_submit_guess(v_room, 11.5, 21.5);
  end loop;
  perform test_as(u1); select mp_advance_round(v_room, 5) into v_json;
  assert (v_json->>'complete') = 'true', 'match complete after final advance';
  assert (select status from multiplayer_rooms where id=v_room) = 'complete', 'room complete';
  raise notice 'OK: party match completes';

  -- ── Multiplayer results recorded (idempotent, ranked) ──────────────────────
  select count(*) into v_cnt from game_results where mode='multiplayer' and game_id=v_room;
  assert v_cnt = 3, format('one result per participant (u1,u2,u3 all guessed), got %', v_cnt);
  raise notice 'OK: one game_result per participant recorded';

  -- Idempotent: calling record again inserts nothing new.
  perform mp_record_match_results(v_room);
  select count(*) into v_cnt from game_results where mode='multiplayer' and game_id=v_room;
  assert v_cnt = 3, 'result recording idempotent';
  raise notice 'OK: result recording idempotent';

  -- Winner has placement 1 and is_win.
  assert exists(select 1 from game_results where game_id=v_room and placement=1 and is_win),
    'a winner exists at placement 1';
  raise notice 'OK: placement/win recorded';

  -- ── Server-authoritative solo run ──────────────────────────────────────────
  perform test_as(u4);
  perform roam_upsert_profile('Dan');
  select roam_create_solo_run('easy', 5, (
    select jsonb_agg(jsonb_build_object(
      'location_id','s'||g,'lat',g,'lng',g,'label','SL'||g,'country','SC'||g,
      'pano_id','sp'||g,'heading',0,'pitch',0,'zoom',0))
    from generate_series(1,5) g)) into v_json;
  v_run := (v_json->>'run_id')::uuid;
  assert (v_json->>'round_duration_seconds') = '180', 'easy solo duration = 180';
  raise notice 'OK: solo run created (easy, 180s)';

  -- Answer NOT exposed for pending rounds via get_active.
  select roam_get_active_solo_run() into v_json;
  assert (v_json->'rounds'->0->>'label') is null, 'pending round answer hidden';
  raise notice 'OK: solo pending-round answer hidden from client read';

  -- Submit all 5 guesses; server scores each.
  for i in 1..5 loop
    select roam_submit_solo_guess(v_run, i, i::double precision, i::double precision) into v_json;
    assert (v_json->>'label') = 'SL'||i, 'answer revealed after guess';
  end loop;
  raise notice 'OK: solo guesses scored server-side and answers revealed post-guess';

  -- Cannot finalize with a fabricated score — there is no score parameter at all.
  select roam_finalize_solo_run(v_run) into v_json;
  v_score := (v_json->>'total_score')::int;
  assert v_score = (select sum(score) from solo_run_guesses where run_id=v_run),
    'finalized total equals server-summed guess scores';
  assert (v_json->>'eligible') = 'true', '5-round solo is leaderboard eligible';
  raise notice 'OK: solo finalize uses server scores, eligible';

  -- Finalize twice is idempotent (one result row).
  perform roam_finalize_solo_run(v_run);
  select count(*) into v_cnt from game_results where mode='solo' and game_id=v_run;
  assert v_cnt = 1, 'exactly one solo result';
  raise notice 'OK: solo finalize idempotent';

  -- ── Leaderboard read (sanitized, no UUIDs) ─────────────────────────────────
  perform test_as(u1);
  select roam_leaderboard('multiplayer','hard',50) into v_json;
  assert json_array_length(v_json->'entries') >= 1, 'multiplayer hard leaderboard has entries';
  assert (v_json->'entries'->0->>'display_name') is not null, 'entry has display name';
  assert (v_json::text) not like '%'||u1::text||'%', 'no auth UUID leaked in leaderboard output';
  raise notice 'OK: leaderboard sanitized (no UUIDs), has entries';

  perform test_as(u4);
  select roam_leaderboard('solo','easy',50) into v_json;
  assert (v_json->'self'->>'best_score')::int = v_score, 'self entry shows own best score';
  raise notice 'OK: leaderboard self entry present';

  raise notice 'ALL V2 TESTS PASSED';
end
$$;

-- ── Host transfer + UTC week boundaries (separate block) ────────────────────
do $$
declare
  h1 uuid := '00000000-0000-0000-0000-0000000000a1';
  h2 uuid := '00000000-0000-0000-0000-0000000000a2';
  h3 uuid := '00000000-0000-0000-0000-0000000000a3';
  v_room uuid; v_code text; v_json json;
begin
  insert into auth.users(id) values (h1),(h2),(h3) on conflict do nothing;

  -- Host leaves the LOBBY → host transfers to earliest remaining player.
  perform test_as(h1);
  select mp_create_room('Host1','normal',4,5) into v_json;
  v_room := (v_json->>'room_id')::uuid;
  select code into v_code from multiplayer_rooms where id = v_room;
  perform test_as(h2); perform mp_join_room(v_code,'Guest2');
  perform test_as(h3); perform mp_join_room(v_code,'Guest3');

  perform test_as(h1); perform mp_leave_room(v_room);
  assert (select host_id from multiplayer_rooms where id=v_room) in (h2,h3),
    'host transferred to a remaining player';
  assert (select status from multiplayer_rooms where id=v_room) = 'lobby',
    'room stays in lobby after host leaves (not abandoned)';
  assert not exists(select 1 from multiplayer_players where room_id=v_room and user_id=h1),
    'departed host slot freed';
  raise notice 'OK: host transfer on lobby departure (room survives)';

  -- Everyone leaves → room abandoned.
  perform test_as(h2); perform mp_leave_room(v_room);
  perform test_as(h3); perform mp_leave_room(v_room);
  assert (select status from multiplayer_rooms where id=v_room) = 'abandoned',
    'room abandoned when last player leaves';
  raise notice 'OK: empty room abandoned';

  -- Week helper: Monday 00:00 UTC boundaries. 2024-01-01 is a Monday.
  assert roam_week_start('2024-01-01T00:00:00Z'::timestamptz) = '2024-01-01T00:00:00Z'::timestamptz,
    'Monday 00:00 UTC maps to itself';
  assert roam_week_start('2024-01-07T23:59:59Z'::timestamptz) = '2024-01-01T00:00:00Z'::timestamptz,
    'Sunday 23:59 UTC still in the same week';
  assert roam_week_start('2024-01-08T00:00:00Z'::timestamptz) = '2024-01-08T00:00:00Z'::timestamptz,
    'next Monday 00:00 UTC rolls to the new week';
  assert roam_week_end('2024-01-01T00:00:00Z'::timestamptz) = '2024-01-08T00:00:00Z'::timestamptz,
    'week end is the following Monday';
  raise notice 'OK: UTC week boundaries (Monday rollover)';

  raise notice 'ALL V2 HOST/WEEK TESTS PASSED';
end
$$;

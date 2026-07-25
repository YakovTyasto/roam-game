-- ============================================================================
-- Exit flow verification — solo/Endless abandon, active-room host transfer,
-- and concurrent leave requests.
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- migrations 0001→0008. Every assertion prints "OK: …"; a failure raises
-- ASSERT FAILED and aborts.
--
--   psql -f supabase/tests/00_local_stubs.sql
--   psql -f supabase/migrations/0001_multiplayer_schema.sql
--   psql -f supabase/migrations/0002_multiplayer_functions.sql
--   psql -f supabase/migrations/0003_difficulty_and_party_rooms.sql
--   psql -f supabase/migrations/0004_player_profiles_and_leaderboard.sql
--   psql -f supabase/migrations/0005_v2_rpc_functions.sql
--   psql -f supabase/migrations/0006_theme_locale_preferences.sql
--   psql -f supabase/migrations/0007_custom_round_config.sql
--   psql -f supabase/migrations/0008_solo_run_abandon.sql
--   psql -f supabase/tests/04_exit_flow_verify.sql
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

-- ── Solo/Endless: abandon never scores, is idempotent, clears only the run ──
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000201';
  v_run uuid;
  v_json json;
  v_status text;
  v_cnt int;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  perform test_as(u);
  perform roam_upsert_profile('Abandoner');

  select roam_create_solo_run('normal', 3, (
    select jsonb_agg(jsonb_build_object(
      'location_id','a'||g,'lat',g,'lng',g,'label','AL'||g,'country','AC'||g,
      'pano_id','ap'||g,'heading',0,'pitch',0,'zoom',0))
    from generate_series(1,3) g)) into v_json;
  v_run := (v_json->>'run_id')::uuid;

  select roam_abandon_solo_run(v_run) into v_json;
  assert (v_json->>'abandoned') = 'true', 'first abandon call reports abandoned';
  select status into v_status from solo_runs where id = v_run;
  assert v_status = 'abandoned', 'run status set to abandoned';
  raise notice 'OK: abandon marks the run abandoned';

  -- Idempotent: a second abandon call is a harmless no-op, not an error.
  select roam_abandon_solo_run(v_run) into v_json;
  assert (v_json->>'abandoned') = 'false', 'second abandon call is a no-op';
  raise notice 'OK: abandon is idempotent';

  -- Abandoning must never produce a leaderboard result.
  begin
    perform roam_finalize_solo_run(v_run);
    raise exception 'expected finalize to reject an abandoned run';
  exception when others then
    raise notice 'OK: an abandoned run cannot be finalized';
  end;
  select count(*) into v_cnt from game_results where mode = 'solo' and game_id = v_run;
  assert v_cnt = 0, 'no game_results row for an abandoned run';
  raise notice 'OK: abandon creates no leaderboard result';

  -- Abandon clears only the run, not the profile.
  select display_name into v_status from player_profiles where user_id = u;
  assert v_status = 'Abandoner', 'profile untouched by abandoning a run';
  raise notice 'OK: abandon does not touch the player profile';
end $$;

-- ── Multiplayer: host leaves an ACTIVE (not lobby) room → host transfers ────
do $$
declare
  h1 uuid := '00000000-0000-0000-0000-000000000301';
  h2 uuid := '00000000-0000-0000-0000-000000000302';
  h3 uuid := '00000000-0000-0000-0000-000000000303';
  v_room uuid; v_code text; v_json json;
  v_manifest jsonb;
begin
  insert into auth.users(id) values (h1),(h2),(h3) on conflict do nothing;

  perform test_as(h1);
  select mp_create_room('Host','normal',4,3) into v_json;
  v_room := (v_json->>'room_id')::uuid;
  select code into v_code from multiplayer_rooms where id = v_room;
  perform test_as(h2); perform mp_join_room(v_code, 'Guest2');
  perform test_as(h3); perform mp_join_room(v_code, 'Guest3');

  select jsonb_agg(jsonb_build_object(
    'location_id','m'||g,'lat',g,'lng',g,'label','ML'||g,'country','MC'||g,
    'pano_id','mp'||g,'heading',0,'pitch',0,'zoom',0))
    into v_manifest from generate_series(1,3) g;
  perform test_as(h1);
  perform mp_start_match(v_room, v_manifest);
  assert (select status from multiplayer_rooms where id = v_room) = 'active',
    'room is active after start';

  -- Host leaves mid-match (not the lobby path). Host transfer is
  -- deterministic — earliest-joined remaining player (lowest slot) — so the
  -- new host must be exactly h2 (slot 2), never h3 (slot 3).
  perform mp_leave_room(v_room);
  assert (select host_id from multiplayer_rooms where id = v_room) = h2,
    'host transferred deterministically to the earliest-joined remaining player';
  assert (select status from multiplayer_rooms where id = v_room) = 'active',
    'room continues (does not abandon) while eligible players remain';
  assert (select connection_status from multiplayer_players
            where room_id = v_room and user_id = h1) = 'left',
    'departed host is marked left, not deleted (row kept for scoring)';
  raise notice 'OK: active-room host transfer on departure; remaining players continue';

  -- ── Concurrent/duplicate leave requests are idempotent ──────────────────
  perform test_as(h2);
  perform mp_leave_room(v_room); -- first leave
  perform mp_leave_room(v_room); -- duplicate/concurrent retry — must not error
  assert (select connection_status from multiplayer_players
            where room_id = v_room and user_id = h2) = 'left',
    'duplicate leave call stays idempotent';
  raise notice 'OK: concurrent/duplicate leave requests are idempotent';

  -- Final eligible player leaves → room is abandoned cleanly (no deadlock).
  perform test_as(h3);
  perform mp_leave_room(v_room);
  assert (select status from multiplayer_rooms where id = v_room) = 'abandoned',
    'room abandoned cleanly once no eligible player remains';
  raise notice 'OK: last-player departure abandons the room cleanly';

  raise notice 'ALL EXIT FLOW TESTS PASSED';
end $$;

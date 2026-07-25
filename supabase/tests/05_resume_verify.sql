-- ============================================================================
-- Solo run resume verification (migration 0009).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- migrations 0001→0009. Every assertion prints "OK: …"; a failure raises
-- ASSERT FAILED and aborts.
--
--   ... (0001→0008 as in the other READMEs) ...
--   psql -f supabase/migrations/0009_solo_run_resume.sql
--   psql -f supabase/tests/05_resume_verify.sql
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000401';
  v_run uuid;
  v_json json;
  v_round json;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  perform test_as(u);

  select roam_create_solo_run('normal', 3, (
    select jsonb_agg(jsonb_build_object(
      'location_id','r'||g,'lat',g,'lng',g,'label','RL'||g,'country','RC'||g,
      'pano_id','rp'||g,'heading',0,'pitch',0,'zoom',0))
    from generate_series(1,3) g)) into v_json;
  v_run := (v_json->>'run_id')::uuid;

  -- Resume payload now carries what solo/resume.ts needs to restore the timer.
  select roam_get_active_solo_run() into v_json;
  assert (v_json->>'server_now') is not null, 'server_now present for client-side timer math';
  select v_json->'rounds'->0 into v_round;
  assert (v_round->>'started_at') is not null, 'round 1 started_at present (it is auto-activated)';
  assert (v_round->>'location_id') = 'r1', 'location_id present (safe to reveal, like pano_id)';
  raise notice 'OK: resume payload carries server_now + started_at + location_id';

  -- The hidden-answer guarantee for a PENDING/ACTIVE round is unchanged by
  -- this migration — only 'complete' rounds reveal lat/lng/label/country.
  assert (v_round->>'lat') is null, 'active round lat still hidden';
  assert (v_round->>'lng') is null, 'active round lng still hidden';
  assert (v_round->>'label') is null, 'active round label still hidden';
  assert (v_round->>'country') is null, 'active round country still hidden';
  assert (v_round->>'pano_id') = 'rp1', 'pano_id still unconditionally present (needed to render)';
  raise notice 'OK: pending-round answer stays hidden after the resume migration';

  -- Guess once, then confirm the completed round now reveals everything and
  -- the next round carries a fresh started_at (server time, not client time).
  perform roam_submit_solo_guess(v_run, 1, 1, 1);
  select roam_get_active_solo_run() into v_json;
  select v_json->'rounds'->0 into v_round;
  assert (v_round->>'label') = 'RL1', 'completed round reveals its answer';
  select v_json->'rounds'->1 into v_round;
  assert (v_round->>'status') = 'active', 'round 2 activated';
  assert (v_round->>'started_at') is not null, 'round 2 has its own started_at';
  raise notice 'OK: completing a round reveals it and starts the next round''s server-time clock';

  raise notice 'ALL RESUME TESTS PASSED';
end $$;

-- ============================================================================
-- Durable location-history verification (migration 0011).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- migrations 0001→0011. Every assertion prints "OK: …"; a failure raises
-- ASSERT FAILED and aborts.
--
--   psql -f supabase/tests/00_local_stubs.sql
--   psql -f supabase/migrations/0001_multiplayer_schema.sql
--   ... (0002→0010) ...
--   psql -f supabase/migrations/0011_location_history.sql
--   psql -f supabase/tests/07_location_history_verify.sql
--
-- Covers: privacy isolation, grants, bounded storage, replay semantics,
-- argument validation, signed-out behaviour, and the reset path.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

-- Rate limits are asserted separately (below); clear counters between phases so
-- the functional assertions are not fighting the burst windows.
create or replace function test_clear_rate_limits() returns void language sql as $$
  delete from public.rate_limits;
$$;

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000701';
  u2 uuid := '00000000-0000-0000-0000-000000000702';
  v_json json;
  v_groups text[];
  v_count int;
  v_failed boolean;
  v_limit int := public.roam_location_history_limit();
  i int;
begin
  insert into auth.users(id) values (u1),(u2) on conflict do nothing;
  delete from public.location_history where user_id in (u1, u2);
  perform test_clear_rate_limits();

  -- ── Recording ───────────────────────────────────────────────────────────
  perform test_as(u1);
  v_json := public.roam_record_location_history(array['paris-eiffel','tokyo-shibuya'], 'normal', 'world', 'solo');
  assert (v_json->>'recorded')::int = 2, 'two places recorded';

  select array_agg(value::text order by ordinal)
    into v_groups
    from json_array_elements_text(public.roam_get_location_history()->'groups')
      with ordinality as t(value, ordinal);
  assert array_length(v_groups, 1) = 2, 'history reads back two places';
  raise notice 'OK: rounds are recorded and read back';

  -- ── Replay moves the timestamp instead of duplicating ────────────────────
  perform pg_sleep(0.01);
  perform public.roam_record_location_history(array['paris-eiffel'], 'hard', 'europe', 'multiplayer');
  select count(*) into v_count from public.location_history where user_id = u1;
  assert v_count = 2, format('replay must not duplicate, got %s rows', v_count);

  select array_agg(value::text order by ordinal)
    into v_groups
    from json_array_elements_text(public.roam_get_location_history()->'groups')
      with ordinality as t(value, ordinal);
  assert v_groups[1] = 'paris-eiffel', 'the replayed place moves to the front (newest-first)';

  assert exists (
    select 1 from public.location_history
     where user_id = u1 and group_id = 'paris-eiffel' and difficulty = 'hard' and mode = 'multiplayer'
  ), 'replay updates difficulty/mode metadata';
  raise notice 'OK: replaying a place moves it to the front without duplicating';

  -- ── Duplicates inside one call are collapsed ─────────────────────────────
  v_json := public.roam_record_location_history(array['dup','dup','dup'], 'normal', 'world', 'solo');
  assert (v_json->>'recorded')::int = 1, 'duplicates within one call collapse to one row';
  raise notice 'OK: duplicate ids in one call are de-duplicated';

  -- ── Privacy: one player never sees another's history ─────────────────────
  perform test_as(u2);
  perform public.roam_record_location_history(array['rio-copacabana'], 'easy', 'world', 'solo');
  select array_agg(value::text)
    into v_groups
    from json_array_elements_text(public.roam_get_location_history()->'groups') as t(value);
  assert v_groups = array['rio-copacabana'],
    format('u2 sees only their own history, got %s', v_groups);

  perform test_as(u1);
  select array_agg(value::text)
    into v_groups
    from json_array_elements_text(public.roam_get_location_history()->'groups') as t(value);
  assert not ('rio-copacabana' = any(v_groups)), 'u1 cannot see u2''s history';
  raise notice 'OK: history is private to its owner';

  -- ── Bounded storage: the newest `limit` places are kept ──────────────────
  perform test_clear_rate_limits();
  delete from public.location_history where user_id = u1;
  for i in 1..(v_limit + 30) loop
    -- Inserted directly (not through the RPC) so this stays fast; the trim is
    -- exercised by the RPC call immediately afterwards.
    insert into public.location_history (user_id, group_id, played_at)
      values (u1, 'bulk-' || i, now() - (make_interval(secs => (v_limit + 30 - i))));
  end loop;
  perform public.roam_record_location_history(array['newest-place'], 'normal', 'world', 'solo');

  select count(*) into v_count from public.location_history where user_id = u1;
  assert v_count = v_limit, format('history is capped at %s rows, got %s', v_limit, v_count);
  assert exists (select 1 from public.location_history where user_id = u1 and group_id = 'newest-place'),
    'the newest place survives the trim';
  assert not exists (select 1 from public.location_history where user_id = u1 and group_id = 'bulk-1'),
    'the oldest place is trimmed away';
  raise notice 'OK: per-player history is bounded and trims oldest-first';

  -- The read is capped too, even when a larger limit is requested.
  select count(*) into v_count
    from json_array_elements_text(public.roam_get_location_history(100000)->'groups') as t(value);
  assert v_count = v_limit, format('read is capped at %s, got %s', v_limit, v_count);
  raise notice 'OK: reads cannot exceed the configured limit';

  -- ── Argument validation ──────────────────────────────────────────────────
  perform test_clear_rate_limits();

  v_failed := false;
  begin
    perform public.roam_record_location_history(array['x'], 'impossible', 'world', 'solo');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an unknown difficulty is rejected';

  v_failed := false;
  begin
    perform public.roam_record_location_history(array['x'], 'normal', 'world', 'cheating');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an unknown mode is rejected';

  v_failed := false;
  begin
    perform public.roam_record_location_history(
      array(select 'k' || g from generate_series(1, 30) g), 'normal', 'world', 'solo');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an oversized batch is rejected';

  -- Malformed entries are dropped, not fatal: a partially corrupt local cache
  -- must still sync the good part rather than failing the whole call.
  v_json := public.roam_record_location_history(array['', null, 'good-one'], 'normal', 'world', 'solo');
  assert (v_json->>'recorded')::int = 1, 'empty/null ids are skipped, valid ones still recorded';

  v_json := public.roam_record_location_history(null, 'normal', 'world', 'solo');
  assert (v_json->>'recorded')::int = 0, 'a null array is a no-op, not an error';
  raise notice 'OK: arguments are validated and malformed entries fail safely';

  -- ── Signed-out behaviour ─────────────────────────────────────────────────
  perform set_config('test.uid', '', false);
  v_json := public.roam_get_location_history();
  assert v_json->>'groups' = '[]', 'a signed-out read returns an empty history, not an error';

  v_failed := false;
  begin
    perform public.roam_record_location_history(array['x'], 'normal', 'world', 'solo');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a signed-out write is rejected';
  raise notice 'OK: signed-out reads degrade gracefully; writes are rejected';

  -- ── Reset ────────────────────────────────────────────────────────────────
  perform test_as(u1);
  perform test_clear_rate_limits();
  v_json := public.roam_reset_location_history();
  assert (v_json->>'deleted')::int > 0, 'reset reports how much it deleted';
  select count(*) into v_count from public.location_history where user_id = u1;
  assert v_count = 0, 'reset clears the caller''s history';
  select count(*) into v_count from public.location_history where user_id = u2;
  assert v_count = 1, 'reset does NOT touch another player''s history';
  raise notice 'OK: reset is scoped to the caller';

  -- ── Rate limiting ────────────────────────────────────────────────────────
  perform test_clear_rate_limits();
  for i in 1..40 loop
    perform public.roam_record_location_history(array['rl-' || i], 'normal', 'world', 'solo');
  end loop;
  v_failed := false;
  begin
    perform public.roam_record_location_history(array['rl-over'], 'normal', 'world', 'solo');
  exception when others then
    v_failed := true;
    assert sqlerrm like 'RATE_LIMITED:%', format('rate-limit error is identifiable, got: %', sqlerrm);
  end;
  assert v_failed, 'recording is rate limited';
  raise notice 'OK: recording is rate limited with a stable error prefix';

  perform test_clear_rate_limits();
  delete from public.location_history where user_id in (u1, u2);
end
$$;

-- ── Grants and RLS (checked from the catalog, not by role-switching) ────────
do $$
declare
  v_count int;
begin
  -- The table itself must be unreachable to clients: no direct privileges.
  select count(*) into v_count
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'location_history'
     and grantee in ('anon', 'authenticated');
  assert v_count = 0, format('no direct table grants to clients, found %s', v_count);
  raise notice 'OK: clients have no direct privileges on location_history';

  assert (select relrowsecurity from pg_class where oid = 'public.location_history'::regclass),
    'RLS is enabled on location_history';
  raise notice 'OK: RLS is enabled';

  -- anon must never be able to execute the RPCs (every caller signs in first).
  assert not has_function_privilege('anon',
    'public.roam_record_location_history(text[], text, text, text)', 'execute'),
    'anon cannot record history';
  assert not has_function_privilege('anon',
    'public.roam_get_location_history(int)', 'execute'),
    'anon cannot read history';
  assert not has_function_privilege('anon',
    'public.roam_reset_location_history()', 'execute'),
    'anon cannot reset history';
  raise notice 'OK: anon cannot execute any history RPC';

  assert has_function_privilege('authenticated',
    'public.roam_record_location_history(text[], text, text, text)', 'execute'),
    'authenticated can record history';
  assert has_function_privilege('authenticated',
    'public.roam_get_location_history(int)', 'execute'),
    'authenticated can read history';
  raise notice 'OK: authenticated can execute the intended RPCs';

  -- Every new function must pin its search_path.
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'roam_record_location_history', 'roam_get_location_history',
       'roam_reset_location_history', 'roam_location_history_limit'
     )
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c = 'search_path=public, pg_temp'
     );
  assert v_count = 0, format('%s history function(s) do not pin search_path', v_count);
  raise notice 'OK: every history function pins search_path';

  -- Indexes the trim and the read depend on.
  assert exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'idx_location_history_user_played'),
    'the (user_id, played_at desc) index exists';
  assert exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'idx_location_history_played_at'),
    'the cleanup index exists';
  raise notice 'OK: supporting indexes exist';
end
$$;

do $$
begin
  raise notice '=== 07_location_history_verify.sql: ALL ASSERTIONS PASSED ===';
end
$$;

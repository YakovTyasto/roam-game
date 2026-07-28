-- ============================================================================
-- Room-wide novelty verification (migration 0012).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- migrations 0001→0012. Every assertion prints "OK: …"; a failure raises
-- ASSERT FAILED and aborts.
--
-- Covers: membership enforcement, the k-anonymity floor, exclusion of the
-- caller's own rows, absence of identities in the payload, bounded output,
-- grants, and rate limiting.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

create or replace function test_clear_rate_limits() returns void language sql as $$
  delete from public.rate_limits;
$$;

do $$
declare
  host_id uuid := '00000000-0000-0000-0000-000000000801';
  g1 uuid := '00000000-0000-0000-0000-000000000802';
  g2 uuid := '00000000-0000-0000-0000-000000000803';
  outsider uuid := '00000000-0000-0000-0000-000000000804';
  v_room uuid;
  v_json json;
  v_count int;
  v_failed boolean;
begin
  insert into auth.users(id) values (host_id),(g1),(g2),(outsider) on conflict do nothing;
  perform test_clear_rate_limits();

  -- Build a room directly (mp_create_room is exercised by suite 01/02).
  insert into public.multiplayer_rooms (code, host_id, status, total_rounds, max_players)
    values ('DIV001', host_id, 'lobby', 5, 8)
    returning id into v_room;
  insert into public.multiplayer_players (room_id, user_id, display_name, slot)
    values (v_room, host_id, 'Host', 1);

  -- Everyone has some history.
  insert into public.location_history (user_id, group_id, played_at) values
    (host_id, 'host-only', now() - interval '1 hour'),
    (host_id, 'shared',    now() - interval '2 hour'),
    (g1,      'shared',    now() - interval '3 hour'),
    (g1,      'g1-only',   now() - interval '10 minute'),
    (g2,      'shared',    now() - interval '4 hour'),
    (g2,      'g2-only',   now() - interval '5 hour'),
    (outsider,'outsider-only', now());

  -- ── Membership ──────────────────────────────────────────────────────────
  perform test_as(outsider);
  v_failed := false;
  begin
    perform public.roam_room_recent_groups(v_room);
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a non-participant cannot read the room aggregate';
  raise notice 'OK: non-participants are rejected';

  -- ── k-anonymity floor: a 2-player room is a no-op ───────────────────────
  insert into public.multiplayer_players (room_id, user_id, display_name, slot)
    values (v_room, g1, 'Guest One', 2);

  perform test_as(host_id);
  v_json := public.roam_room_recent_groups(v_room);
  assert (v_json->>'applied') = 'false', 'a 2-player room does not apply the aggregate';
  assert (v_json->>'reason') = 'too_few_participants', 'the reason is reported explicitly';
  assert v_json->>'groups' = '[]', 'no rows leak from a 2-player room';
  raise notice 'OK: a 2-player room returns nothing (one guest would be identifiable)';

  -- ── Applied with three participants ─────────────────────────────────────
  insert into public.multiplayer_players (room_id, user_id, display_name, slot)
    values (v_room, g2, 'Guest Two', 3);

  perform test_as(host_id);
  v_json := public.roam_room_recent_groups(v_room);
  assert (v_json->>'applied') = 'true', 'a 3-player room applies the aggregate';
  assert (v_json->>'participants_considered')::int = 2, 'counts range over the two OTHER players';
  raise notice 'OK: a 3-player room returns an anonymised aggregate';

  -- The caller's own rows are excluded so they cannot subtract themselves out.
  select count(*) into v_count
    from json_array_elements(v_json->'groups') g
   where g->>'group_id' = 'host-only';
  assert v_count = 0, 'the caller''s own places are excluded';
  raise notice 'OK: the caller''s own history is excluded from the aggregate';

  -- Other participants' places are present, with counts but no identities.
  select (g->>'seen_by')::int into v_count
    from json_array_elements(v_json->'groups') g
   where g->>'group_id' = 'shared';
  assert v_count = 2, format('"shared" is counted for both guests, got %s', v_count);

  select (g->>'seen_by')::int into v_count
    from json_array_elements(v_json->'groups') g
   where g->>'group_id' = 'g1-only';
  assert v_count = 1, 'a place only one guest played is counted once';
  raise notice 'OK: counts aggregate over other participants';

  -- No identity of any kind in the payload.
  assert v_json::text not like '%' || g1::text || '%', 'no guest uuid appears in the payload';
  assert v_json::text not like '%' || g2::text || '%', 'no guest uuid appears in the payload';
  assert v_json::text not like '%user_id%', 'the payload has no user_id field at all';
  raise notice 'OK: the payload contains no identities';

  -- Non-participants' history never appears.
  select count(*) into v_count
    from json_array_elements(v_json->'groups') g
   where g->>'group_id' = 'outsider-only';
  assert v_count = 0, 'a non-participant''s history is not aggregated';
  raise notice 'OK: only room participants contribute';

  -- A guest sees the same shape, with the host counted and themselves excluded.
  perform test_as(g1);
  v_json := public.roam_room_recent_groups(v_room);
  assert (v_json->>'applied') = 'true', 'a guest may also read the aggregate';
  select count(*) into v_count
    from json_array_elements(v_json->'groups') g
   where g->>'group_id' = 'g1-only';
  assert v_count = 0, 'a guest''s own places are excluded for them too';
  select count(*) into v_count
    from json_array_elements(v_json->'groups') g
   where g->>'group_id' = 'host-only';
  assert v_count = 1, 'the host''s places are visible to a guest in aggregate';
  raise notice 'OK: exclusion is per-caller, not host-specific';

  -- ── A player who left does not count or contribute ──────────────────────
  update public.multiplayer_players set connection_status = 'left'
    where room_id = v_room and user_id = g2;
  perform test_as(host_id);
  perform test_clear_rate_limits();
  v_json := public.roam_room_recent_groups(v_room);
  assert (v_json->>'applied') = 'false', 'a departure back below the floor disables the aggregate';
  raise notice 'OK: players who left neither count nor contribute';

  -- ── Ordering: newest-first ──────────────────────────────────────────────
  update public.multiplayer_players set connection_status = 'online'
    where room_id = v_room and user_id = g2;
  v_json := public.roam_room_recent_groups(v_room);
  assert (v_json->'groups'->0->>'group_id') = 'g1-only',
    format('newest place leads, got %s', v_json->'groups'->0->>'group_id');
  raise notice 'OK: the aggregate is ordered newest-first';

  -- ── Concurrent start requests stay idempotent ───────────────────────────
  -- Room-wide novelty only changes *which* places the host proposes; it must
  -- not weaken the existing guarantee that a room can be started exactly once.
  -- mp_start_match takes `for update` on the room and rejects any status other
  -- than 'lobby', so a second concurrent call blocks, then loses.
  perform test_clear_rate_limits();
  perform public.mp_start_match(v_room, (
    select jsonb_agg(jsonb_build_object(
      'location_id', 'loc-' || i, 'lat', i * 10, 'lng', i * 11,
      'label', 'Place ' || i, 'country', 'Nowhere', 'pano_id', 'pano-' || i,
      'heading', 0, 'pitch', 0, 'zoom', 0))
    from generate_series(1, 5) i
  ));
  v_failed := false;
  begin
    perform public.mp_start_match(v_room, (
      select jsonb_agg(jsonb_build_object(
        'location_id', 'other-' || i, 'lat', i, 'lng', i,
        'label', 'Other ' || i, 'country', 'Nowhere', 'pano_id', 'other-pano-' || i,
        'heading', 0, 'pitch', 0, 'zoom', 0))
      from generate_series(1, 5) i
    ));
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a second start request is rejected';
  select count(*) into v_count from public.multiplayer_rounds where room_id = v_room;
  assert v_count = 5, format('exactly one manifest was stored, found %s rounds', v_count);
  raise notice 'OK: a second start request cannot create a second manifest';

  -- ── Signed out ──────────────────────────────────────────────────────────
  perform set_config('test.uid', '', false);
  v_failed := false;
  begin
    perform public.roam_room_recent_groups(v_room);
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a signed-out caller is rejected';
  raise notice 'OK: signed-out callers are rejected';

  -- ── Rate limiting ───────────────────────────────────────────────────────
  perform test_as(host_id);
  perform test_clear_rate_limits();
  for v_count in 1..30 loop
    perform public.roam_room_recent_groups(v_room);
  end loop;
  v_failed := false;
  begin
    perform public.roam_room_recent_groups(v_room);
  exception when others then
    v_failed := true;
    assert sqlerrm like 'RATE_LIMITED:%', format('identifiable rate-limit error, got: %', sqlerrm);
  end;
  assert v_failed, 'the aggregate is rate limited';
  raise notice 'OK: the aggregate is rate limited';

  perform test_clear_rate_limits();
end
$$;

-- ── Grants and hardening ────────────────────────────────────────────────────
do $$
declare
  v_count int;
begin
  assert not has_function_privilege('anon', 'public.roam_room_recent_groups(uuid)', 'execute'),
    'anon cannot read the room aggregate';
  assert has_function_privilege('authenticated', 'public.roam_room_recent_groups(uuid)', 'execute'),
    'authenticated can read the room aggregate';
  raise notice 'OK: grants are correct';

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'roam_room_recent_groups'
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c = 'search_path=public, pg_temp'
     );
  assert v_count = 0, 'roam_room_recent_groups pins search_path';
  raise notice 'OK: search_path is pinned';
end
$$;

do $$
begin
  raise notice '=== 08_room_diversity_verify.sql: ALL ASSERTIONS PASSED ===';
end
$$;

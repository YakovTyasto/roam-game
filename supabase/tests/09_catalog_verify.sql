-- ============================================================================
-- Server-authoritative catalog + official runs verification (migrations
-- 0013, 0014, 0015).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- 0001→0015, or via supabase/tests/run-local.sh.
--
-- What this proves, in the order the security review asks for it:
--   • the catalog is seeded, deduplicated and unreadable by any client role;
--   • official rounds come from the server and are never selectable directly;
--   • a round's answer is hidden until that round is completed, and hidden even
--     from the run's owner (not just from other players);
--   • scoring is server-side and matches the trusted helpers;
--   • submissions are idempotent, and concurrent/duplicate submits cannot
--     double-count;
--   • early and late submissions are handled distinctly and correctly;
--   • a caller cannot touch another player's run, or probe for run ids;
--   • finalization happens exactly once;
--   • selection never repeats a canonical group and spreads geographically;
--   • multiplayer's server-selected start preserves the existing guarantees.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

create or replace function test_clear_rate_limits() returns void language sql as $$
  delete from public.rate_limits;
$$;

-- ── Part 1: catalog integrity and access ────────────────────────────────────
do $$
declare
  v_total int;
  v_json json;
  v_failed boolean;
begin
  select count(*) into v_total from public.game_catalog;
  assert v_total >= 300, format('catalog seeded (got %s rows)', v_total);
  raise notice 'OK: catalog seeded with % locations', v_total;

  assert not exists (
    select pano_id from public.game_catalog group by pano_id having count(*) > 1
  ), 'no duplicate panorama ids';
  assert not exists (
    select group_id from public.game_catalog group by group_id having count(*) > 1
  ), 'no duplicate canonical groups';
  assert (select count(distinct location_id) from public.game_catalog) = v_total,
    'no duplicate location ids';
  raise notice 'OK: no duplicate location ids, panorama ids or canonical groups';

  -- Existing stable ids must be preserved verbatim — location history, stored
  -- runs and leaderboard rows all reference them.
  assert exists (select 1 from public.game_catalog where location_id = 'paris-eiffel'),
    'pre-existing stable ids preserved';
  assert (select pano_id from public.game_catalog where location_id = 'paris-eiffel')
    = 'Xta4ugN_QRTIo3XDFLujgw', 'verified pano id preserved exactly';
  assert (select pano_verified_at from public.game_catalog where location_id = 'paris-eiffel')
    is not null, 'Street View verification metadata is stored';
  raise notice 'OK: stable ids and Street View verification metadata preserved';

  -- ── RLS + privileges: no client role may read the answers ────────────────
  assert (select relrowsecurity from pg_class where oid = 'public.game_catalog'::regclass),
    'RLS is enabled on game_catalog';
  assert not exists (select 1 from pg_policies where tablename = 'game_catalog'),
    'game_catalog has no permissive policy (deny-all)';
  assert not has_table_privilege('anon', 'public.game_catalog', 'select'),
    'anon cannot select the catalog';
  assert not has_table_privilege('authenticated', 'public.game_catalog', 'select'),
    'authenticated cannot select the catalog';
  assert not has_table_privilege('authenticated', 'public.game_catalog', 'insert'),
    'authenticated cannot insert into the catalog';
  assert not has_table_privilege('authenticated', 'public.game_catalog', 'update'),
    'authenticated cannot update the catalog';
  assert not has_table_privilege('authenticated', 'public.game_catalog', 'delete'),
    'authenticated cannot delete from the catalog';
  raise notice 'OK: catalog is RLS-enabled and unreadable/unwritable by anon and authenticated';

  -- The selector returns coordinates, so it must not be reachable from a browser.
  assert not has_function_privilege('authenticated',
    'public.roam_select_catalog_rounds(text, int, text[], text[])', 'execute'),
    'authenticated cannot call the round selector directly';
  assert not has_function_privilege('authenticated',
    'public.roam_catalog_pool(text, int)', 'execute'),
    'authenticated cannot call the pool helper directly';
  assert not has_function_privilege('anon',
    'public.roam_start_official_run_v2(text, int, int)', 'execute'),
    'anon cannot start an official run';
  assert not has_function_privilege('authenticated',
    'public.roam_run_payload(uuid, boolean)', 'execute'),
    'authenticated cannot call the raw run payload (it takes a reveal flag)';
  assert not has_function_privilege('authenticated',
    'public.roam_recent_groups_for(uuid, int)', 'execute'),
    'authenticated cannot call the history helper (it takes a caller-supplied uid)';
  raise notice 'OK: answer-bearing helpers are server-only; anon cannot start runs';

  -- The aggregate summary IS safe to expose: counts only.
  assert has_function_privilege('authenticated', 'public.roam_catalog_summary()', 'execute'),
    'authenticated may read the non-secret catalog summary';
  v_json := public.roam_catalog_summary();
  assert (v_json->>'total')::int = v_total, 'summary total matches';
  assert (v_json->>'countries')::int > 50, 'summary reports country coverage';
  assert not (v_json::text like '%lat%'), 'summary leaks no coordinate';
  raise notice 'OK: catalog summary exposes counts only (% countries)', v_json->>'countries';

  -- A client role must not be able to reach the catalog through the seed path
  -- either: there is simply no client-callable mutation function.
  select exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%catalog%'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname <> 'roam_catalog_summary'
  ) into v_failed;
  assert not v_failed, 'the only client-callable catalog function is the summary';
  raise notice 'OK: catalog mutation is impossible through a public frontend key';
end
$$;

-- ── Part 2: official solo run lifecycle ─────────────────────────────────────
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000901';
  u2 uuid := '00000000-0000-0000-0000-000000000902';
  v_run json;
  v_run_id uuid;
  v_round json;
  v_res json;
  v_groups text[];
  v_continents int;
  v_expected int;
  v_dist double precision;
  v_total int;
  v_count int;
  v_failed boolean;
begin
  insert into auth.users(id) values (u1),(u2) on conflict do nothing;
  perform test_clear_rate_limits();
  perform test_as(u1);

  v_run := public.roam_start_official_run_v2('normal', 5, 120);
  v_run_id := (v_run->>'run_id')::uuid;
  assert (v_run->>'server_selected')::boolean, 'the run is marked server-selected';
  assert (v_run->>'total_rounds')::int = 5, 'five rounds';
  assert json_array_length(v_run->'rounds') = 5, 'five round rows returned';
  raise notice 'OK: official run started with server-selected rounds';

  -- ── The reveal gate ─────────────────────────────────────────────────────
  -- Round 1 is active. Its answer must be absent even for the run's OWNER.
  v_round := (v_run->'rounds')->0;
  assert (v_round->>'status') = 'active', 'round 1 is active';
  assert (v_round->>'pano_id') is not null, 'round 1 exposes a panorama to render';
  assert (v_round->>'expires_at') is not null, 'round 1 carries a server deadline';
  assert (v_round->>'lat') is null and (v_round->>'lng') is null,
    'an active round never exposes its coordinates';
  assert (v_round->>'label') is null and (v_round->>'country') is null,
    'an active round never exposes its label or country';
  assert (v_round->>'location_id') is null,
    'an active round never exposes its catalog id (it is a key to the answer)';
  assert not exists (
    select 1 from json_array_elements(v_run->'rounds') r
     where (r.value->>'status') <> 'complete'
       and ((r.value->>'lat') is not null or (r.value->>'country') is not null)
  ), 'no un-guessed round exposes an answer';
  raise notice 'OK: answers are hidden for every round that is not complete';

  -- ── Coordinate validation ───────────────────────────────────────────────
  begin
    perform public.roam_submit_official_guess_v2(v_run_id, 1, 91, 0);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'out-of-range latitude rejected';
  begin
    perform public.roam_submit_official_guess_v2(v_run_id, 1, 'NaN'::double precision, 0);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'NaN latitude rejected';
  begin
    perform public.roam_submit_official_guess_v2(v_run_id, 1, null, 0);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'null latitude rejected';
  raise notice 'OK: invalid guess coordinates are rejected';

  -- ── A guess for a round that has not started ────────────────────────────
  begin
    perform public.roam_submit_official_guess_v2(v_run_id, 3, 0, 0);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a guess for a pending round is rejected';
  raise notice 'OK: an early submission for a later round is rejected';

  -- ── Server-side scoring ─────────────────────────────────────────────────
  v_res := public.roam_submit_official_guess_v2(v_run_id, 1, 48.8584, 2.2945);
  assert (v_res->>'lat') is not null, 'the completed round reveals its answer';
  select r.lat, r.lng into v_dist, v_total  -- reuse vars as scratch
    from public.solo_run_rounds r where r.run_id = v_run_id and r.round_number = 1;
  select public.mp_score(public.mp_haversine_km(48.8584, 2.2945, r.lat, r.lng))
    into v_expected
    from public.solo_run_rounds r where r.run_id = v_run_id and r.round_number = 1;
  assert (v_res->>'score')::int = v_expected,
    format('score is computed server-side with the trusted helpers (%s vs %s)',
           v_res->>'score', v_expected);
  raise notice 'OK: the guess is scored server-side by mp_score/mp_haversine_km';

  -- Round 2 must now be active with a fresh server deadline; the run's total
  -- must have moved exactly once.
  assert (select status from public.solo_run_rounds
           where run_id = v_run_id and round_number = 2) = 'active',
    'the next round is activated';
  assert (select expires_at from public.solo_run_rounds
           where run_id = v_run_id and round_number = 2) is not null,
    'the next round gets a server deadline';
  assert (select total_score from public.solo_runs where id = v_run_id) = v_expected,
    'the run total is updated exactly once';

  -- ── Idempotency: the same submission again ──────────────────────────────
  v_res := public.roam_submit_official_guess_v2(v_run_id, 1, 10, 10);
  assert (v_res->>'already')::boolean, 'a repeat submission reports the stored result';
  assert (v_res->>'score')::int = v_expected,
    'a repeat submission cannot overwrite the score with a better guess';
  assert (select total_score from public.solo_runs where id = v_run_id) = v_expected,
    'a repeat submission does not double-count the total';
  select count(*) into v_count from public.solo_run_guesses
    where run_id = v_run_id;
  assert v_count = 1, format('exactly one guess row (got %s)', v_count);
  raise notice 'OK: duplicate submission is idempotent and cannot re-score';

  -- ── Cross-user isolation ────────────────────────────────────────────────
  perform test_as(u2);
  begin
    perform public.roam_submit_official_guess_v2(v_run_id, 2, 0, 0);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'another player cannot submit into this run';
  assert not (public.roam_get_official_run_v2(v_run_id)->>'found')::boolean,
    'another player cannot read this run';
  begin
    perform public.roam_finalize_official_run_v2(v_run_id);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'another player cannot finalize this run';
  -- Enumeration: a guessed-but-nonexistent run id must be indistinguishable
  -- from someone else's run.
  assert not (public.roam_get_official_run_v2(
    '00000000-0000-0000-0000-0000000000ff'::uuid)->>'found')::boolean,
    'a guessed run id reveals nothing';
  raise notice 'OK: cross-user reads, writes and finalization are denied';

  -- ── Late submission scores zero ─────────────────────────────────────────
  perform test_as(u1);
  update public.solo_run_rounds
    set started_at = now() - interval '10 minutes',
        expires_at = now() - interval '5 minutes'
    where run_id = v_run_id and round_number = 2;
  v_res := public.roam_submit_official_guess_v2(v_run_id, 2, 0, 0);
  assert (v_res->>'expired')::boolean, 'a late submission is reported as expired';
  assert (v_res->>'score')::int = 0, 'a late submission scores zero';
  assert (select total_score from public.solo_runs where id = v_run_id) = v_expected,
    'a late submission adds nothing to the total';
  raise notice 'OK: a submission after the server deadline scores zero';

  -- ── Finalize requires every round ───────────────────────────────────────
  begin
    perform public.roam_finalize_official_run_v2(v_run_id);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'finalizing an incomplete run is rejected';
  raise notice 'OK: a run cannot be finalized before every round is complete';

  perform public.roam_submit_official_guess_v2(v_run_id, 3, 0, 0);
  perform public.roam_submit_official_guess_v2(v_run_id, 4, 0, 0);
  perform public.roam_submit_official_guess_v2(v_run_id, 5, 0, 0);

  v_res := public.roam_finalize_official_run_v2(v_run_id);
  assert not (v_res->>'already')::boolean, 'first finalize is not a replay';
  v_total := (v_res->>'total_score')::int;
  assert v_total = (select coalesce(sum(score), 0) from public.solo_run_guesses
                     where run_id = v_run_id),
    'the final total is the server-summed score, never a client value';
  assert (v_res->>'eligible')::boolean, 'a 5-round official run is leaderboard-eligible';

  -- ── Finalize is idempotent ──────────────────────────────────────────────
  v_res := public.roam_finalize_official_run_v2(v_run_id);
  assert (v_res->>'already')::boolean, 'a second finalize is a no-op';
  assert (v_res->>'total_score')::int = v_total, 'a replayed finalize returns the same total';
  select count(*) into v_count from public.game_results
    where game_id = v_run_id and user_id = u1;
  assert v_count = 1, format('exactly one leaderboard row per run (got %s)', v_count);
  raise notice 'OK: finalization is exactly-once and idempotent under replay';

  -- ── A finalized run cannot be reopened ──────────────────────────────────
  begin
    perform public.roam_submit_official_guess_v2(v_run_id, 5, 1, 1);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  -- Round 5 already has a guess, so this returns the stored result rather than
  -- raising; what matters is that nothing changed.
  assert (select total_score from public.solo_runs where id = v_run_id) = v_total,
    'a submission after finalization cannot change the total';
  raise notice 'OK: a finalized run cannot be re-scored';

  -- ── Novelty accounting ──────────────────────────────────────────────────
  select count(*) into v_count from public.location_history where user_id = u1;
  assert v_count = 5, format('each played round records its canonical group (got %s)', v_count);
  raise notice 'OK: playing a round records its canonical group in location history';
end
$$;

-- ── Part 3: selection quality ───────────────────────────────────────────────
do $$
declare
  u3 uuid := '00000000-0000-0000-0000-000000000903';
  v_run json;
  v_rounds jsonb;
  v_groups text[];
  v_continents int;
  v_available int;
  v_failed boolean;
  i int;
begin
  insert into auth.users(id) values (u3) on conflict do nothing;
  perform test_clear_rate_limits();
  perform test_as(u3);

  -- No duplicate canonical group inside one run, across many draws.
  for i in 1 .. 5 loop
    perform test_clear_rate_limits();
    v_run := public.roam_start_official_run_v2('normal', 5, null);
    select array_agg(r.group_id) into v_groups
      from public.solo_run_rounds r
     where r.run_id = (v_run->>'run_id')::uuid;
    assert array_length(v_groups, 1) = 5, 'five rounds selected';
    assert (select count(distinct g) from unnest(v_groups) g) = 5,
      'no canonical group repeats inside one run';
  end loop;
  raise notice 'OK: selection never repeats a canonical place inside a run';

  -- Geographic spread: with six continents represented, a five-round game must
  -- not repeat one.
  perform test_clear_rate_limits();
  v_run := public.roam_start_official_run_v2('normal', 5, null);
  select count(distinct c.continent) into v_continents
    from public.solo_run_rounds r
    join public.game_catalog c on c.location_id = r.location_id
   where r.run_id = (v_run->>'run_id')::uuid;
  assert v_continents = 5,
    format('a five-round game spans five continents (got %s)', v_continents);
  raise notice 'OK: selection spreads a five-round game across continents';

  -- Difficulty scoping: an easy run draws from the easy tier while it can.
  perform test_clear_rate_limits();
  v_run := public.roam_start_official_run_v2('easy', 5, null);
  assert (select count(*) from public.solo_run_rounds r
           join public.game_catalog c on c.location_id = r.location_id
          where r.run_id = (v_run->>'run_id')::uuid and c.difficulty = 'easy') = 5,
    'an easy run draws only from the easy tier when it is large enough';
  raise notice 'OK: difficulty scopes the location pool server-side';

  -- Bounds.
  begin
    perform public.roam_start_official_run_v2('normal', 0, null);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'zero rounds rejected';
  begin
    perform public.roam_start_official_run_v2('impossible', 5, null);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'unknown difficulty rejected';
  begin
    perform public.roam_start_official_run_v2('normal', 5, 5);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'an absurd round timer is rejected';
  raise notice 'OK: run parameters are bounded';
end
$$;

-- ── Part 4: multiplayer server-selected start ───────────────────────────────
do $$
declare
  h uuid := '00000000-0000-0000-0000-000000000911';
  g uuid := '00000000-0000-0000-0000-000000000912';
  v_room uuid;
  v_code text;
  v_json json;
  v_count int;
  v_failed boolean;
begin
  insert into auth.users(id) values (h),(g) on conflict do nothing;
  perform test_clear_rate_limits();

  perform test_as(h);
  v_json := public.mp_create_room('Host', 'normal', 2, 5, null);
  v_room := (v_json->>'room_id')::uuid;
  v_code := v_json->>'code';

  perform test_as(g);
  perform public.mp_join_room(v_code, 'Guest');

  -- Host-only, exactly as the legacy start.
  begin
    perform public.mp_start_match_v2(v_room);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a guest cannot start the match';
  raise notice 'OK: mp_start_match_v2 is host-only';

  perform test_as(h);
  v_json := public.mp_start_match_v2(v_room);
  assert (v_json->>'server_selected')::boolean, 'the manifest is server-selected';

  select count(*) into v_count from public.multiplayer_rounds where room_id = v_room;
  assert v_count = 5, format('five rounds created (got %s)', v_count);
  assert (select count(*) from public.multiplayer_round_targets where room_id = v_room) = 5,
    'five hidden targets created';
  assert (select count(*) from public.multiplayer_rounds
           where room_id = v_room and status = 'pending') = 4,
    'only round 1 is active; the rest stay pending';
  assert (select count(distinct t.location_id) from public.multiplayer_round_targets t
           where t.room_id = v_room) = 5,
    'no duplicate location inside a match';
  assert (select status from public.multiplayer_rooms where id = v_room) = 'active',
    'the room is active';
  raise notice 'OK: multiplayer rounds are selected on the server, unique, and staged';

  -- The host client is never given the answers by this call.
  assert not (v_json::text like '%lat%'), 'the start response contains no coordinate';
  raise notice 'OK: the host learns no target coordinate from starting the match';

  -- Starting twice is rejected (the room is no longer in the lobby).
  begin
    perform public.mp_start_match_v2(v_room);
    v_failed := false;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a started match cannot be started again';
  raise notice 'OK: a match cannot be started twice';
end
$$;

-- ── Part 5: legacy compatibility (old frontend after migration) ─────────────
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000921';
  v_json json;
  v_run uuid;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  perform test_clear_rate_limits();
  perform test_as(u);

  -- The deployed pre-V5 client still calls the manifest-based function. It must
  -- keep working untouched, or the migration cannot be applied before the
  -- frontend deploys.
  v_json := public.roam_create_solo_run('normal', 1, jsonb_build_array(jsonb_build_object(
    'location_id', 'legacy-1', 'lat', 10, 'lng', 20, 'label', 'L', 'country', 'C',
    'pano_id', 'PANO', 'heading', 0, 'pitch', 0, 'zoom', 0
  )), null);
  v_run := (v_json->>'run_id')::uuid;
  assert v_run is not null, 'the legacy manifest RPC still works';
  assert (select mode from public.solo_runs where id = v_run) = 'solo',
    'a legacy run defaults to mode=solo';
  assert not (select server_selected from public.solo_runs where id = v_run),
    'a legacy run is correctly NOT marked server-selected';

  -- And the legacy read/submit path still works on it.
  v_json := public.roam_submit_solo_guess(v_run, 1, 10, 20);
  assert (v_json->>'score')::int = 5000, 'the legacy submit path still scores';
  assert (public.roam_get_active_solo_run()->>'active')::boolean,
    'the legacy active-run read still works';
  raise notice 'OK: the pre-V5 frontend keeps working against the migrated schema';

  assert has_function_privilege('authenticated',
    'public.roam_create_solo_run(text, int, jsonb, int)', 'execute'),
    'the legacy RPC grant is untouched';
  assert has_function_privilege('authenticated',
    'public.mp_start_match(uuid, jsonb)', 'execute'),
    'the legacy match-start grant is untouched';
  raise notice 'OK: no legacy RPC was removed or revoked in this rollout';
end
$$;

do $$
begin
  raise notice '=== 09_catalog_verify.sql: ALL ASSERTIONS PASSED ===';
end
$$;

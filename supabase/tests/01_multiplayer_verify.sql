\set ON_ERROR_STOP on
\pset pager off

create or replace function pg_temp.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if not cond then raise exception 'ASSERT FAILED: %', msg;
  else raise notice 'OK: %', msg;
  end if;
end $$;

-- Test users
insert into auth.users(id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333')
on conflict do nothing;

\echo '### Scoring parity ###'
do $$
begin
  perform pg_temp.assert(public.mp_score(0) = 5000, 'score(0)=5000');
  perform pg_temp.assert(public.mp_score(100) = 4756, 'score(100)=4756');
  perform pg_temp.assert(public.mp_score(2000) = 1839, 'score(2000)=1839');
  perform pg_temp.assert(public.mp_score(-5) = 0, 'score(negative)=0');
  perform pg_temp.assert(public.mp_score('infinity'::double precision) = 0, 'score(inf)=0');
  perform pg_temp.assert(round(public.mp_haversine_km(48.8584,2.2945,51.5007,-0.1246)::numeric,4) = 340.5389, 'haversine paris-london');
  perform pg_temp.assert(public.mp_score(public.mp_haversine_km(48.8584,2.2945,51.5007,-0.1246)) = 4217, 'paris-london score=4217');
end $$;

\echo '### Create + join ###'
select set_config('test.uid','11111111-1111-1111-1111-111111111111',false) \g
select public.mp_create_room('  Alex <b>  ') as j \gset
select set_config('test.rid', (:'j'::json->>'room_id'), false) as _ \gset
select set_config('test.code', (:'j'::json->>'code'), false) as _ \gset

do $$
declare v_name text; v_code text; v_slot int;
begin
  select display_name, slot into v_name, v_slot from public.multiplayer_players
    where room_id = current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_name = 'Alex b', 'host name sanitised to "Alex b" (got: '||v_name||')');
  perform pg_temp.assert(v_slot = 1, 'host is slot 1');
  select code into v_code from public.multiplayer_rooms where id = current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$', 'code uses unambiguous alphabet: '||v_code);
end $$;

-- B joins
select set_config('test.uid','22222222-2222-2222-2222-222222222222',false) \g
select public.mp_join_room(current_setting('test.code'), 'Bella') as _ \gset
do $$
declare v_n int;
begin
  select count(*) into v_n from public.multiplayer_players where room_id = current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_n = 2, 'two players in room');
end $$;

-- Idempotent rejoin (same user, e.g. reconnect / second tab) — no new row
select public.mp_join_room(current_setting('test.code'), 'Bella again') as _ \gset
do $$
declare v_n int;
begin
  select count(*) into v_n from public.multiplayer_players where room_id = current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_n = 2, 'rejoin is idempotent (still 2 players)');
end $$;

\echo '### Two-player cap ###'
do $$
begin
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333',false);
  begin
    perform public.mp_join_room(current_setting('test.code'), 'Cara');
    raise exception 'TEST FAILED: third player allowed';
  exception when others then
    perform pg_temp.assert(sqlerrm like '%full%', 'third join rejected: '||sqlerrm);
  end;
end $$;

\echo '### Host-only start ###'
do $$
begin
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222',false); -- guest
  begin
    perform public.mp_start_match(current_setting('test.rid')::uuid,
      '[{"location_id":"x","lat":0,"lng":0,"label":"l","country":"c","pano_id":"p","heading":0}]'::jsonb);
    raise exception 'TEST FAILED: guest could start';
  exception when others then
    perform pg_temp.assert(sqlerrm like '%host%', 'guest start rejected: '||sqlerrm);
  end;
end $$;

\echo '### Start match (valid manifest) ###'
select set_config('test.uid','11111111-1111-1111-1111-111111111111',false) \g
select public.mp_start_match(current_setting('test.rid')::uuid, $json$[
  {"location_id":"loc1","lat":48.8584,"lng":2.2945,"label":"Paris","country":"France","pano_id":"pano1","heading":10,"pitch":0,"zoom":0},
  {"location_id":"loc2","lat":40.0,"lng":-74.0,"label":"NYC","country":"USA","pano_id":"pano2","heading":20,"pitch":0,"zoom":0},
  {"location_id":"loc3","lat":35.0,"lng":139.0,"label":"Tokyo","country":"Japan","pano_id":"pano3","heading":30,"pitch":0,"zoom":0},
  {"location_id":"loc4","lat":-33.0,"lng":151.0,"label":"Sydney","country":"Australia","pano_id":"pano4","heading":40,"pitch":0,"zoom":0},
  {"location_id":"loc5","lat":51.5,"lng":-0.12,"label":"London","country":"UK","pano_id":"pano5","heading":50,"pitch":0,"zoom":0}
]$json$::jsonb) as _ \gset

do $$
declare v_status text; v_cr int; v_rounds int; v_r1 text; v_pending int;
begin
  select status, current_round into v_status, v_cr from public.multiplayer_rooms where id=current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_status='active' and v_cr=1, 'room active on round 1');
  select count(*) into v_rounds from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_rounds=5, '5 rounds created');
  select status into v_r1 from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid and round_number=1;
  perform pg_temp.assert(v_r1='active', 'round 1 active');
  select count(*) into v_pending from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid and status='pending';
  perform pg_temp.assert(v_pending=4, 'rounds 2-5 pending (hidden)');
end $$;

-- Duplicate location in manifest rejected (fresh lobby)
\echo '### Manifest validation (duplicate location) ###'
do $$
declare v_j json; v_rid uuid;
begin
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
  v_j := public.mp_create_room('Alex');
  v_rid := (v_j->>'room_id')::uuid;
  -- add B so 2 players
  insert into public.multiplayer_players(room_id,user_id,display_name,slot)
    values (v_rid,'22222222-2222-2222-2222-222222222222','Bella',2);
  begin
    perform public.mp_start_match(v_rid, $j$[
      {"location_id":"dup","lat":0,"lng":0,"label":"l","country":"c","pano_id":"p","heading":0},
      {"location_id":"dup","lat":1,"lng":1,"label":"l","country":"c","pano_id":"p","heading":0},
      {"location_id":"c","lat":2,"lng":2,"label":"l","country":"c","pano_id":"p","heading":0},
      {"location_id":"d","lat":3,"lng":3,"label":"l","country":"c","pano_id":"p","heading":0},
      {"location_id":"e","lat":4,"lng":4,"label":"l","country":"c","pano_id":"p","heading":0}
    ]$j$::jsonb);
    raise exception 'TEST FAILED: duplicate location accepted';
  exception when others then
    perform pg_temp.assert(sqlerrm like '%duplicate%', 'duplicate location rejected: '||sqlerrm);
  end;
end $$;

\echo '### Submit guess (idempotent, server-scored) ###'
-- A submits a guess near Paris
select set_config('test.uid','11111111-1111-1111-1111-111111111111',false) \g
select public.mp_submit_guess(current_setting('test.rid')::uuid, 48.0, 2.0) as _ \gset
do $$
declare v_score int; v_dist double precision; v_sub int; v_rstatus text;
begin
  select score, distance_km into v_score, v_dist from public.multiplayer_guesses g
    join public.multiplayer_rounds r on r.id=g.round_id
    where r.room_id=current_setting('test.rid')::uuid and r.round_number=1 and g.user_id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert(round(v_dist::numeric,4)=97.8916, 'A distance ~97.8916 (got '||round(v_dist::numeric,4)||')');
  perform pg_temp.assert(v_score=4761, 'A server score=4761 (got '||v_score||')');
  select submitted_count, status into v_sub, v_rstatus from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid and round_number=1;
  perform pg_temp.assert(v_sub=1 and v_rstatus='active', 'submitted_count=1, round still active');
end $$;

-- A double-submits → idempotent (no new guess, count stays 1, cannot change guess)
select public.mp_submit_guess(current_setting('test.rid')::uuid, 10.0, 10.0) as _ \gset
do $$
declare v_lat double precision; v_sub int; v_cnt int;
begin
  select count(*) into v_cnt from public.multiplayer_guesses g join public.multiplayer_rounds r on r.id=g.round_id
    where r.room_id=current_setting('test.rid')::uuid and r.round_number=1 and g.user_id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert(v_cnt=1, 'still exactly one guess for A (no overwrite)');
  select lat into v_lat from public.multiplayer_guesses g join public.multiplayer_rounds r on r.id=g.round_id
    where r.room_id=current_setting('test.rid')::uuid and r.round_number=1 and g.user_id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert(v_lat=48.0, 'guess unchanged after double submit');
  select submitted_count into v_sub from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid and round_number=1;
  perform pg_temp.assert(v_sub=1, 'submitted_count stayed 1');
end $$;

-- B submits → both in → round completes + totals updated
select set_config('test.uid','22222222-2222-2222-2222-222222222222',false) \g
select public.mp_submit_guess(current_setting('test.rid')::uuid, 60.0, 5.0) as _ \gset
do $$
declare v_rstatus text; v_atotal int; v_btotal int;
begin
  select status into v_rstatus from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid and round_number=1;
  perform pg_temp.assert(v_rstatus='complete', 'round completes when both submit');
  select total_score into v_atotal from public.multiplayer_players where room_id=current_setting('test.rid')::uuid and user_id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert(v_atotal=4761, 'A total updated to round score 4761');
  select total_score into v_btotal from public.multiplayer_players where room_id=current_setting('test.rid')::uuid and user_id='22222222-2222-2222-2222-222222222222';
  perform pg_temp.assert(v_btotal >= 0, 'B total set from server score ('||v_btotal||')');
end $$;

\echo '### Advance is idempotent under concurrent clicks ###'
select set_config('test.uid','11111111-1111-1111-1111-111111111111',false) \g
select public.mp_advance_round(current_setting('test.rid')::uuid, 1) as _ \gset
select public.mp_advance_round(current_setting('test.rid')::uuid, 1) as _ \gset
select set_config('test.uid','22222222-2222-2222-2222-222222222222',false) \g
select public.mp_advance_round(current_setting('test.rid')::uuid, 1) as _ \gset
do $$
declare v_cr int; v_r2 text;
begin
  select current_round into v_cr from public.multiplayer_rooms where id=current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_cr=2, 'current_round=2 after multiple advance(from=1) calls (no double-advance)');
  select status into v_r2 from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid and round_number=2;
  perform pg_temp.assert(v_r2='active', 'round 2 now active');
end $$;

\echo '### Timer: early expiry rejected, late expiry accepted ###'
do $$
begin
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
  begin
    perform public.mp_expire_round(current_setting('test.rid')::uuid);
    raise exception 'TEST FAILED: early expiry accepted';
  exception when others then
    perform pg_temp.assert(sqlerrm like '%not expired%', 'early expiry rejected: '||sqlerrm);
  end;
end $$;
-- Backdate round 2 start beyond the duration, then expiry should succeed with 0 scores
update public.multiplayer_rounds set started_at = now() - interval '200 seconds'
  where room_id=current_setting('test.rid')::uuid and round_number=2;
select public.mp_expire_round(current_setting('test.rid')::uuid) as _ \gset
do $$
declare v_r2 text; v_atotal int;
begin
  select status into v_r2 from public.multiplayer_rounds where room_id=current_setting('test.rid')::uuid and round_number=2;
  perform pg_temp.assert(v_r2='complete', 'round 2 completes after deadline');
  select total_score into v_atotal from public.multiplayer_players where room_id=current_setting('test.rid')::uuid and user_id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.assert(v_atotal=4761, 'no points added for a round nobody guessed (still 4761)');
end $$;

\echo '### Play out remaining rounds to completion ###'
do $$
declare i int;
begin
  for i in 2..5 loop
    -- advance from round i (complete) to i+1 or finish
    perform set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
    perform public.mp_advance_round(current_setting('test.rid')::uuid, i);
    -- for rounds that become active, backdate + expire to complete quickly
    if i < 5 then
      update public.multiplayer_rounds set started_at = now() - interval '200 seconds'
        where room_id=current_setting('test.rid')::uuid and round_number=i+1;
      perform public.mp_expire_round(current_setting('test.rid')::uuid);
    end if;
  end loop;
end $$;
do $$
declare v_status text;
begin
  select status into v_status from public.multiplayer_rooms where id=current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_status='complete', 'room complete after final round advance');
end $$;

\echo '### Rematch (idempotent) ###'
select set_config('test.uid','11111111-1111-1111-1111-111111111111',false) \g
select public.mp_create_rematch(current_setting('test.rid')::uuid) as j2 \gset
select set_config('test.new1', (:'j2'::json->>'room_id'), false) as _ \gset
select public.mp_create_rematch(current_setting('test.rid')::uuid) as j3 \gset
select set_config('test.new2', (:'j3'::json->>'room_id'), false) as _ \gset
do $$
declare v_new uuid; v_players int; v_link uuid; v_status text;
begin
  perform pg_temp.assert(current_setting('test.new1') = current_setting('test.new2'), 'rematch idempotent: same new room both times');
  v_new := current_setting('test.new1')::uuid;
  select count(*) into v_players from public.multiplayer_players where room_id=v_new;
  perform pg_temp.assert(v_players=2, 'rematch copied exactly 2 players');
  select rematch_room_id into v_link from public.multiplayer_rooms where id=current_setting('test.rid')::uuid;
  perform pg_temp.assert(v_link=v_new, 'old room links to rematch room');
  select status into v_status from public.multiplayer_rooms where id=v_new;
  perform pg_temp.assert(v_status='lobby', 'rematch room is a fresh lobby');
end $$;

\echo 'ALL PART 1 TESTS PASSED'

-- ===========================================================================
-- Part 2: Row Level Security + privilege enforcement
-- ===========================================================================
insert into auth.users(id) values
  ('44444444-4444-4444-4444-444444444444'),
  ('55555555-5555-5555-5555-555555555555'),
  ('66666666-6666-6666-6666-666666666666')
on conflict do nothing;

-- ── Setup a mid-round scenario as the trusted owner (RLS bypassed) ──────────
select set_config('test.uid','44444444-4444-4444-4444-444444444444',false) \g
select public.mp_create_room('Dana') as j \gset
select set_config('test.rid2', (:'j'::json->>'room_id'), false) as _ \gset
select set_config('test.code2', (:'j'::json->>'code'), false) as _ \gset
select set_config('test.uid','55555555-5555-5555-5555-555555555555',false) \g
select public.mp_join_room(current_setting('test.code2'), 'Eli') as _ \gset
select set_config('test.uid','44444444-4444-4444-4444-444444444444',false) \g
select public.mp_start_match(current_setting('test.rid2')::uuid, $json$[
  {"location_id":"L1","lat":48.8584,"lng":2.2945,"label":"Paris","country":"France","pano_id":"p1","heading":10},
  {"location_id":"L2","lat":40.0,"lng":-74.0,"label":"NYC","country":"USA","pano_id":"p2","heading":20},
  {"location_id":"L3","lat":35.0,"lng":139.0,"label":"Tokyo","country":"Japan","pano_id":"p3","heading":30},
  {"location_id":"L4","lat":-33.0,"lng":151.0,"label":"Sydney","country":"Australia","pano_id":"p4","heading":40},
  {"location_id":"L5","lat":51.5,"lng":-0.12,"label":"London","country":"UK","pano_id":"p5","heading":50}
]$json$::jsonb) as _ \gset
-- Only Dana submits; round 1 stays active (Eli has not guessed yet).
select public.mp_submit_guess(current_setting('test.rid2')::uuid, 48.0, 2.0) as _ \gset

-- ── RLS: participant Dana ───────────────────────────────────────────────────
\echo '### RLS: participant visibility ###'
set role authenticated;
select set_config('test.uid','44444444-4444-4444-4444-444444444444',false) \g
do $$
declare v_rooms int; v_players int; v_rounds int; v_myguess int; v_targets int;
begin
  select count(*) into v_rooms from public.multiplayer_rooms where id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_rooms=1, 'participant can read their room');
  select count(*) into v_players from public.multiplayer_players where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_players=2, 'participant sees both players');
  select count(*) into v_rounds from public.multiplayer_rounds where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_rounds=1, 'only the active round is visible (pending rounds hidden)');
  select count(*) into v_myguess from public.multiplayer_guesses where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_myguess=1, 'Dana sees her own guess');
  select count(*) into v_targets from public.multiplayer_round_targets where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_targets=0, 'target answer hidden while round is active');
end $$;

-- ── RLS: opponent Eli cannot see Dana's guess before reveal ─────────────────
\echo '### RLS: opponent guess hidden before reveal ###'
select set_config('test.uid','55555555-5555-5555-5555-555555555555',false) \g
do $$
declare v_guesses int;
begin
  select count(*) into v_guesses from public.multiplayer_guesses where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_guesses=0, 'Eli cannot see the opponent guess while the round is active');
end $$;

-- ── RLS: non-participant sees nothing ───────────────────────────────────────
\echo '### RLS: non-participant blocked ###'
select set_config('test.uid','66666666-6666-6666-6666-666666666666',false) \g
do $$
declare v_rooms int; v_players int;
begin
  select count(*) into v_rooms from public.multiplayer_rooms where id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_rooms=0, 'non-participant cannot read the room');
  select count(*) into v_players from public.multiplayer_players where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_players=0, 'non-participant cannot read players');
end $$;

-- ── Direct writes are denied (no INSERT/UPDATE/DELETE grants) ───────────────
\echo '### Direct client writes denied ###'
select set_config('test.uid','44444444-4444-4444-4444-444444444444',false) \g
do $$
begin
  begin
    update public.multiplayer_players set total_score = 999999
      where room_id = current_setting('test.rid2')::uuid;
    raise exception 'TEST FAILED: score was directly modifiable';
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'cannot directly modify a score (permission denied)');
  end;
  begin
    update public.multiplayer_rooms set status='complete'
      where id = current_setting('test.rid2')::uuid;
    raise exception 'TEST FAILED: room status was directly modifiable';
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'cannot directly modify room status');
  end;
  begin
    insert into public.multiplayer_guesses(round_id,room_id,player_id,user_id,lat,lng,distance_km,score)
      values (gen_random_uuid(), current_setting('test.rid2')::uuid, gen_random_uuid(), auth.uid(), 0,0,0,5000);
    raise exception 'TEST FAILED: could directly insert a guess';
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'cannot directly insert a guess');
  end;
end $$;

-- ── Reveal after both submit ────────────────────────────────────────────────
\echo '### Reveal after both submit ###'
select set_config('test.uid','55555555-5555-5555-5555-555555555555',false) \g
select public.mp_submit_guess(current_setting('test.rid2')::uuid, 20.0, 3.0) as _ \gset
-- Now round 1 is complete; Eli should see both guesses + the target.
do $$
declare v_guesses int; v_targets int;
begin
  select count(*) into v_guesses from public.multiplayer_guesses where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_guesses=2, 'both guesses visible after round completes');
  select count(*) into v_targets from public.multiplayer_round_targets where room_id=current_setting('test.rid2')::uuid;
  perform pg_temp.assert(v_targets=1, 'target revealed after round completes');
end $$;

-- ── Function privileges: authenticated allowed, anon denied ──────────────────
\echo '### Function grants ###'
select set_config('test.uid','44444444-4444-4444-4444-444444444444',false) \g
do $$
declare v_now timestamptz;
begin
  select public.mp_server_now() into v_now;
  perform pg_temp.assert(v_now is not null, 'authenticated may call mp_server_now');
end $$;

reset role;
set role anon;
do $$
begin
  begin
    perform public.mp_create_room('Hacker');
    raise exception 'TEST FAILED: anon could call mp_create_room';
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'anon (unauthenticated) cannot call mp_create_room');
  end;
end $$;
reset role;

\echo 'ALL PART 2 TESTS PASSED'

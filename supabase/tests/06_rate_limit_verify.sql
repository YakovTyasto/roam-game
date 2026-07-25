-- ============================================================================
-- Rate limiting verification (migration 0010).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- migrations 0001→0010. Every assertion prints "OK: …"; a failure raises
-- ASSERT FAILED and aborts.
--
--   ... (0001→0009 as in the other READMEs) ...
--   psql -f supabase/migrations/0010_rate_limiting.sql
--   psql -f supabase/tests/06_rate_limit_verify.sql
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000501';
  u2 uuid := '00000000-0000-0000-0000-000000000502';
  i int;
  v_failed boolean;
begin
  insert into auth.users(id) values (u1),(u2) on conflict do nothing;

  -- ── Allowed usage: calls within the limit all succeed ───────────────────
  perform test_as(u1);
  for i in 1..3 loop
    perform roam_check_rate_limit('test_action', 3, 60);
  end loop;
  raise notice 'OK: calls within the limit succeed';

  -- ── Burst rejection: the next call over the limit is rejected ───────────
  v_failed := false;
  begin
    perform roam_check_rate_limit('test_action', 3, 60);
  exception when others then
    v_failed := true;
    assert sqlerrm like 'RATE_LIMITED:%', format('error is identifiable, got: %', sqlerrm);
  end;
  assert v_failed, 'the 4th call within the window is rejected';
  raise notice 'OK: burst over the limit is rejected with a stable error prefix';

  -- ── Cross-user isolation: u2 has an independent counter ─────────────────
  perform test_as(u2);
  for i in 1..3 loop
    perform roam_check_rate_limit('test_action', 3, 60);
  end loop;
  raise notice 'OK: a different user is not affected by u1''s rate limit';

  -- u2 also gets rejected on their own 4th call (limit applies per-user, not
  -- globally disabled) — and u1's own state is not visible/affected by u2.
  v_failed := false;
  begin
    perform roam_check_rate_limit('test_action', 3, 60);
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'u2 is independently rate-limited at their own 4th call';
  raise notice 'OK: cross-user isolation holds in both directions';

  -- ── Storage never grows unbounded: old buckets are eventually purged ───
  -- (functional check: the cleanup path runs without error on a normal call)
  perform roam_check_rate_limit('cleanup_smoke_test', 1000, 60);
  raise notice 'OK: rate_limits cleanup path runs without error';

  raise notice 'ALL RATE LIMIT TESTS PASSED';
end $$;

-- ── Cooldown recovery: a short window (1s) allows calls again after it elapses ──
-- Deliberately OUTSIDE a do $$ $$ block: now()/transaction_timestamp() is
-- frozen for the life of one transaction, so pg_sleep() must straddle two
-- separate top-level statements (each its own implicit transaction, exactly
-- like separate RPC calls from a client) to actually observe elapsed time.
select test_as('00000000-0000-0000-0000-000000000501');
select roam_check_rate_limit('short_window_action', 1, 1); -- 1st call: ok

do $$
begin
  perform roam_check_rate_limit('short_window_action', 1, 1);
  raise exception 'expected the 2nd call within the window to be rejected';
exception when others then
  if sqlerrm not like 'RATE_LIMITED:%' then raise; end if;
  raise notice 'OK: second call within the 1s window is rejected';
end $$;

select pg_sleep(1.1);
select roam_check_rate_limit('short_window_action', 1, 1); -- must not raise — new window

do $$
begin
  raise notice 'OK: cooldown recovers once the window elapses';
end $$;

-- ── Proof the pattern is actually wired into a real RPC (mp_create_room) ──
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000503';
  i int;
  v_failed boolean := false;
begin
  insert into auth.users(id) values (u) on conflict do nothing;
  perform test_as(u);

  -- Burst limit is 3/minute — the first 3 rooms succeed.
  for i in 1..3 loop
    perform mp_create_room('Host'||i, 'normal', 2, 5);
  end loop;
  raise notice 'OK: mp_create_room allows up to its burst limit';

  begin
    perform mp_create_room('HostOver', 'normal', 2, 5);
  exception when others then
    v_failed := true;
    assert sqlerrm like 'RATE_LIMITED:%', 'mp_create_room over-limit error is identifiable';
  end;
  assert v_failed, 'a 4th room within the same minute is rejected';
  raise notice 'OK: mp_create_room is actually rate-limited, not just the generic helper';

  raise notice 'ALL RATE LIMIT RPC WIRING TESTS PASSED';
end $$;

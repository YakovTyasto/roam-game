-- ============================================================================
-- pg_safeupdate compatibility (migration 0018).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after every
-- migration, or via supabase/tests/run-local.sh.
--
-- Supabase's Data API runs every request with pg_safeupdate loaded: an UPDATE or
-- DELETE without a WHERE clause raises "UPDATE/DELETE requires a WHERE clause",
-- even inside a SECURITY DEFINER function. A plain local Postgres does not load
-- the extension, so the behavioural suites cannot catch this class of bug — the
-- Daily Challenge shipped broken because of exactly one such statement.
--
-- This suite is therefore a static check over the *final* definition of every
-- public function: no statement may be an UPDATE/DELETE without a WHERE clause.
-- Test helpers (`test_%`) are exempt; they never run behind the API.
-- ============================================================================

\set ON_ERROR_STOP on

-- Every unguarded UPDATE/DELETE in a public plpgsql/sql function, one per line.
create or replace function test_safeupdate_offenders() returns text
language plpgsql as $$
declare
  v_fn record;
  v_stmt text;
  v_out text := '';
begin
  for v_fn in
    select p.oid::regprocedure::text as sig,
           -- Drop line comments so commented-out SQL never counts.
           regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prolang in (select oid from pg_language where lanname in ('plpgsql', 'sql'))
       and p.proname not like 'test\_%'
  loop
    for v_stmt in
      select m[1]
        from regexp_matches(v_fn.src,
               '((?:\mupdate\s+[a-z_."]+(?:\s+(?:as\s+)?[a-z_]+)?\s+set\M|\mdelete\s+from\M)[^;]*);',
               'gi') as m
    loop
      -- `on conflict … do update set` has no table name; it is not a bare UPDATE.
      continue when v_stmt ~* '^update\s+set\M';
      if v_stmt !~* '\mwhere\M' then
        v_out := v_out || E'\n  ' || v_fn.sig || ': ' || left(v_stmt, 80);
      end if;
    end loop;
  end loop;
  return v_out;
end;
$$;

-- The guard must be able to fail: deliberately unguarded statements are caught,
-- and a guarded / upsert form is not.
do $$
begin
  create function public.zz_safeupdate_bad_delete() returns void language plpgsql as
    'begin delete from public.rate_limits; end';
  create function public.zz_safeupdate_bad_update() returns void language plpgsql as
    'begin update public.rate_limits r set count = 0; end';
  create function public.zz_safeupdate_ok() returns void language plpgsql as
    'begin
       delete from public.rate_limits where true;
       insert into public.rate_limits (user_id, action, bucket_start, count)
         values (null, ''x'', now(), 1)
         on conflict do nothing;
     end';

  if position('zz_safeupdate_bad_delete' in test_safeupdate_offenders()) = 0 then
    raise exception 'FAIL: the guard missed a bare DELETE';
  end if;
  if position('zz_safeupdate_bad_update' in test_safeupdate_offenders()) = 0 then
    raise exception 'FAIL: the guard missed a bare UPDATE';
  end if;
  if position('zz_safeupdate_ok' in test_safeupdate_offenders()) > 0 then
    raise exception 'FAIL: the guard flagged a statement that has a WHERE clause';
  end if;

  drop function public.zz_safeupdate_bad_delete();
  drop function public.zz_safeupdate_bad_update();
  drop function public.zz_safeupdate_ok();
  raise notice 'OK: the guard detects bare UPDATE/DELETE and accepts guarded ones';
end;
$$;

-- The real assertion over the whole deployed schema.
do $$
declare v_offenders text := test_safeupdate_offenders();
begin
  if v_offenders <> '' then
    raise exception 'FAIL: UPDATE/DELETE without WHERE (breaks under pg_safeupdate):%',
      v_offenders;
  end if;
  raise notice 'OK: no public function issues an UPDATE/DELETE without a WHERE clause';
end;
$$;

\echo '=== 12_safeupdate_verify.sql: ALL ASSERTIONS PASSED ==='

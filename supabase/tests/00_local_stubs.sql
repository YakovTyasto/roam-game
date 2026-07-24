-- ============================================================================
-- LOCAL, THROWAWAY POSTGRES ONLY — DO NOT RUN AGAINST A REAL SUPABASE DATABASE.
--
-- Supabase already provides the `auth` schema, `auth.uid()`, and the `anon` /
-- `authenticated` roles. This file re-creates minimal stand-ins so the real
-- migrations and the verification script can run against a plain local
-- Postgres. Running it against Supabase would shadow the real auth.uid() and
-- break authentication.
--
-- Usage (see README.md):
--   psql -f supabase/tests/00_local_stubs.sql
--   psql -f supabase/migrations/0001_multiplayer_schema.sql
--   psql -f supabase/migrations/0002_multiplayer_functions.sql
--   psql -f supabase/tests/01_multiplayer_verify.sql
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

-- Test harness drives identity via the `test.uid` GUC (see the verify script).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role, public;
grant usage on schema public to anon, authenticated, service_role;

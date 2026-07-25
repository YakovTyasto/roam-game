-- ============================================================================
-- Theme/locale preference sync verification (migration 0006).
--
-- LOCAL, THROWAWAY POSTGRES ONLY (see 00_local_stubs.sql). Run after applying
-- migrations 0001→0006. Every assertion prints "OK: …"; a failure raises
-- ASSERT FAILED and aborts.
--
--   psql -f supabase/tests/00_local_stubs.sql
--   psql -f supabase/migrations/0001_multiplayer_schema.sql
--   psql -f supabase/migrations/0002_multiplayer_functions.sql
--   psql -f supabase/migrations/0003_difficulty_and_party_rooms.sql
--   psql -f supabase/migrations/0004_player_profiles_and_leaderboard.sql
--   psql -f supabase/migrations/0005_v2_rpc_functions.sql
--   psql -f supabase/migrations/0006_theme_locale_preferences.sql
--   psql -f supabase/tests/03_theme_locale_verify.sql
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function test_as(p uuid) returns void language sql as $$
  select set_config('test.uid', p::text, false);
$$;

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000101';
  u2 uuid := '00000000-0000-0000-0000-000000000102';
  v_json json;
begin
  insert into auth.users(id) values (u1),(u2) on conflict do nothing;

  -- No profile yet: set_preferences is a documented no-op, not an error.
  perform test_as(u2);
  select roam_set_preferences('dark', null) into v_json;
  assert (v_json->>'exists') = 'false', 'set_preferences no-op without a profile';
  raise notice 'OK: set_preferences no-ops when no profile exists yet';

  -- Existing profile: columns start NULL (backfill-safe for pre-0006 rows).
  perform test_as(u1);
  perform roam_upsert_profile('Theme Tester');
  select roam_get_profile() into v_json;
  assert (v_json->>'theme_preference') is null, 'theme_preference defaults null';
  assert (v_json->>'locale_preference') is null, 'locale_preference defaults null';
  raise notice 'OK: new/legacy profiles default to null preferences';

  -- Valid update persists and is readable back.
  select roam_set_preferences('light', 'ru') into v_json;
  assert (v_json->>'exists') = 'true', 'set_preferences reports existing profile';
  select roam_get_profile() into v_json;
  assert (v_json->>'theme_preference') = 'light', 'theme_preference stored';
  assert (v_json->>'locale_preference') = 'ru', 'locale_preference stored';
  raise notice 'OK: valid theme/locale preferences persist';

  -- Partial update leaves the other field untouched.
  perform roam_set_preferences('dark', null);
  select roam_get_profile() into v_json;
  assert (v_json->>'theme_preference') = 'dark', 'theme_preference updated alone';
  assert (v_json->>'locale_preference') = 'ru', 'locale_preference untouched by partial update';
  raise notice 'OK: partial preference updates do not clobber the other field';

  -- Invalid values are rejected server-side (never trust the client).
  begin
    perform roam_set_preferences('purple', null);
    raise exception 'expected rejection of invalid theme_preference';
  exception when others then
    raise notice 'OK: invalid theme_preference rejected';
  end;

  begin
    perform roam_set_preferences(null, 'fr');
    raise exception 'expected rejection of invalid locale_preference';
  exception when others then
    raise notice 'OK: invalid locale_preference rejected';
  end;

  -- Cross-user isolation: u2 still has no profile / no leaked state from u1.
  perform test_as(u2);
  select roam_get_profile() into v_json;
  assert (v_json->>'exists') = 'false', 'u2 still has no profile';
  raise notice 'OK: preference state is not leaked across users';

  raise notice 'ALL THEME/LOCALE PREFERENCE TESTS PASSED';
end $$;

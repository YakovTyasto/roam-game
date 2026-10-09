-- ============================================================================
-- Roam hotfix — make catalog selection work under pg_safeupdate.
--
-- INCIDENT
-- Every request that arrives through Supabase's Data API (PostgREST) runs with
-- the pg_safeupdate extension loaded, which rejects any UPDATE or DELETE that has
-- no WHERE clause — including statements inside SECURITY DEFINER functions.
-- roam_select_catalog_rounds (0013) cleared its per-transaction scratch table
-- with a bare `delete from roam_sel_candidates;`, so every caller failed in
-- production with "DELETE requires a WHERE clause" (HTTP 400):
--   • roam_start_daily_v2         → the Daily Challenge could never start
--   • roam_start_official_run_v2  → official solo runs
--   • roam_create_challenge_v2    → shared challenge links
--   • mp_start_match_v2           → server-selected multiplayer rounds
-- The local suites never saw it because a plain Postgres has no pg_safeupdate.
--
-- FIX
-- Re-create the function with the one statement changed to
-- `delete from roam_sel_candidates where true;`. Identical behaviour otherwise;
-- same signature, so existing grants (none — internal only) are preserved.
-- supabase/tests/12_safeupdate_verify.sql now fails the build if any public
-- function body ever contains an unguarded UPDATE/DELETE again.
--
-- Additive per the migration rules: 0013 stays frozen; this file supersedes the
-- function definition only.
-- ============================================================================

create or replace function public.roam_select_catalog_rounds(
  p_difficulty text,
  p_count int,
  p_exclude_groups text[] default '{}',
  p_recent_groups text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_used_continents text[] := '{}';
  v_used_groups text[] := coalesce(p_exclude_groups, '{}');
  v_pick record;
  v_continents_available int;
  i int;
begin
  if p_count < 1 or p_count > 50 then
    raise exception 'Invalid round count.';
  end if;

  -- Candidate list, ordered once: preferred tier, then not-recently-seen, then
  -- random. Materialised so the greedy continent pass below is cheap.
  create temporary table if not exists roam_sel_candidates (
    ord int,
    location_id text,
    group_id text,
    pano_id text,
    lat double precision,
    lng double precision,
    label text,
    country text,
    continent text,
    difficulty text,
    setting text,
    heading double precision,
    pitch double precision,
    zoom double precision
  ) on commit drop;
  -- `where true`, not a bare DELETE: Supabase's API runs every request with
  -- pg_safeupdate, which rejects UPDATE/DELETE without a WHERE clause.
  delete from roam_sel_candidates where true;

  insert into roam_sel_candidates
  select row_number() over (
           order by p.tier_rank,
                    (case when p.group_id = any (coalesce(p_recent_groups, '{}')) then 1 else 0 end),
                    random()
         )::int,
         p.location_id, p.group_id, p.pano_id, p.lat, p.lng, p.label, p.country,
         p.continent, p.difficulty, p.setting, p.heading, p.pitch, p.zoom
    from public.roam_catalog_pool(p_difficulty, p_count) p
   where not (p.group_id = any (coalesce(p_exclude_groups, '{}')));

  select count(distinct continent) into v_continents_available from roam_sel_candidates;

  for i in 1 .. p_count loop
    -- Prefer an unused continent while one is still available; otherwise take
    -- the best remaining candidate. Never returns a group already chosen.
    select * into v_pick
      from roam_sel_candidates c
     where not (c.group_id = any (v_used_groups))
       and (
         array_length(v_used_continents, 1) is null
         or array_length(v_used_continents, 1) >= v_continents_available
         or not (c.continent = any (v_used_continents))
       )
     order by c.ord
     limit 1;

    if not found then
      -- Spread relaxed: take any remaining candidate rather than short-change
      -- the round count.
      select * into v_pick
        from roam_sel_candidates c
       where not (c.group_id = any (v_used_groups))
       order by c.ord
       limit 1;
    end if;

    if not found then
      raise exception 'CATALOG_EXHAUSTED: only % of % rounds could be selected.',
        jsonb_array_length(v_rows), p_count;
    end if;

    v_used_groups := array_append(v_used_groups, v_pick.group_id);
    if not (v_pick.continent = any (v_used_continents)) then
      v_used_continents := array_append(v_used_continents, v_pick.continent);
    end if;

    v_rows := v_rows || jsonb_build_object(
      'round_number', i,
      'location_id', v_pick.location_id,
      'group_id', v_pick.group_id,
      'pano_id', v_pick.pano_id,
      'lat', v_pick.lat,
      'lng', v_pick.lng,
      'label', v_pick.label,
      'country', v_pick.country,
      'continent', v_pick.continent,
      'difficulty', v_pick.difficulty,
      'setting', v_pick.setting,
      -- A stored heading keeps every player in a shared game facing the same
      -- way; jitter it per selection so one place never opens identically twice.
      'heading', ((v_pick.heading + floor(random() * 360))::numeric % 360)::double precision,
      'pitch', v_pick.pitch,
      'zoom', v_pick.zoom
    );
  end loop;

  return v_rows;
end;
$$;

revoke all on function public.roam_select_catalog_rounds(text, int, text[], text[])
  from public, anon, authenticated;

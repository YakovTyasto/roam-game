-- ============================================================================
-- Roam Engagement Core V5 — server-authoritative location catalog (schema).
--
-- INCREMENTAL migration on top of 0012. Purely additive: one new table plus
-- internal helper functions. No existing table, policy, grant or function is
-- touched, so applying this cannot affect a live game and the currently
-- deployed frontend keeps working unchanged.
--
-- WHY THIS EXISTS
-- Until now the *client* told the server what the answers were:
-- roam_create_solo_run(p_manifest) and mp_start_match(p_manifest) both accept
-- lat/lng/label/country from the browser. That was acceptable while the whole
-- catalog shipped in the bundle anyway — the client already knew everything —
-- but it makes official, comparable scores impossible: a modified client can
-- pick easy locations, or place a "guess" on a target it read from its own
-- manifest. Daily Challenge and shared challenges are only meaningful if the
-- answer set lives somewhere the player cannot read.
--
-- So the catalog moves here, and official runs get their rounds from the
-- database. The TypeScript catalog (src/data/locations.ts) stays — it is still
-- the source used for development, the audit/verification tooling, the seed in
-- 0014, unit tests, and the offline Classic Solo fallback (explicitly
-- non-official). It is no longer the authority for an official score.
--
-- TRUST MODEL
--   • RLS is enabled with NO policy, and every direct privilege is revoked from
--     anon and authenticated: the table is unreadable and unwritable by any
--     browser key. There is no "SELECT the catalog" RPC either.
--   • Rows are written only by migrations (service role / owner). Catalog
--     mutation is therefore impossible through a public frontend key, and no
--     service-role credential is ever shipped to a client.
--   • The selection helper below is SECURITY DEFINER with no grant, so it is
--     callable only from inside another trusted function.
--
-- UNAVOIDABLE LIMITATION — READ BEFORE CLAIMING THE ANSWERS ARE SECRET
-- To render a round, the browser must receive the active panorama id. A
-- sophisticated player can feed that id back to Google's own Street View
-- services and recover the location. Server authority removes the *bulk* leak
-- (the entire answer set sitting in the JS bundle) and makes scoring
-- untrusted-client-proof; it cannot hide the panorama that is currently on
-- screen. This is documented in docs/ENGAGEMENT_CORE_V5.md and is a property of
-- Street View, not of this schema.
-- ============================================================================

-- ── Catalog table ───────────────────────────────────────────────────────────

create table if not exists public.game_catalog (
  -- The stable id from src/data/locations.ts. PRESERVED EXACTLY: existing runs,
  -- location history and stored snapshots all reference these strings, so a
  -- rename here would silently orphan a player's history.
  location_id text primary key,
  -- Canonical group id (see src/utils/canonicalGroup.ts). Diversity works on
  -- groups, not ids: two rows for one place occupy one slot.
  group_id text not null,
  pano_id text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  label text not null check (char_length(label) between 1 and 200),
  country text not null check (char_length(country) between 1 and 100),
  continent text not null check (
    continent in ('Africa', 'Asia', 'Europe', 'North America', 'South America',
                  'Oceania', 'Antarctica')
  ),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  setting text not null check (
    setting in ('urban', 'suburban', 'rural', 'landmark', 'remote')
  ),
  heading double precision not null default 0 check (heading >= 0 and heading < 360),
  pitch double precision not null default 0 check (pitch between -90 and 90),
  zoom double precision not null default 0 check (zoom between 0 and 5),
  -- Soft delete. Withdrawn Street View coverage retires a row instead of
  -- deleting it, so historical results keep resolving.
  active boolean not null default true,
  -- Street View verification metadata: when the pano id was last confirmed to
  -- exist via the metadata endpoint, and by what. Coverage is re-shot and
  -- withdrawn over time, so a verification has an age.
  pano_verified_at date,
  verification_source text not null default 'street_view_metadata'
    check (char_length(verification_source) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One catalog row per panorama. Two rows sharing a pano id would be the same
-- place counted twice, which is exactly what canonical grouping exists to stop.
create unique index if not exists uq_game_catalog_pano on public.game_catalog (pano_id);

-- One row per canonical group *today*.
--
-- Deliberate, and deliberately revisitable: the current catalog is 1:1 (325
-- locations, 325 groups), and enforcing that makes an accidental duplicate
-- impossible to seed. Canonical grouping does however allow a group to have
-- several members on purpose (two reviewed viewpoints of one landmark). Adding
-- such an entry is therefore a *deliberate* change that must drop this index in
-- its own additive migration — see docs/ENGAGEMENT_CORE_V5.md. It must never be
-- dropped as a side effect of a bulk import.
create unique index if not exists uq_game_catalog_group on public.game_catalog (group_id);

-- Serves the difficulty-scoped selection scan.
create index if not exists idx_game_catalog_pool
  on public.game_catalog (difficulty, active);
create index if not exists idx_game_catalog_continent
  on public.game_catalog (continent) where active;

drop trigger if exists trg_game_catalog_updated on public.game_catalog;
create trigger trg_game_catalog_updated
  before update on public.game_catalog
  for each row execute function public.mp_touch_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Enabled with NO policy → deny-all for clients. Combined with the revokes
-- below, no browser key can read a target coordinate out of this table.
alter table public.game_catalog enable row level security;
revoke all on public.game_catalog from anon, authenticated;

-- ── Non-secret summary (safe to expose) ─────────────────────────────────────
-- Counts only: how many places exist per difficulty, and how many distinct
-- countries/continents are represented. Reveals no location and no answer, and
-- the statistics screen needs the denominators ("12 of 79 countries seen").
create or replace function public.roam_catalog_summary()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select json_build_object(
    'total', count(*),
    'easy', count(*) filter (where difficulty = 'easy'),
    'normal', count(*) filter (where difficulty = 'normal'),
    'hard', count(*) filter (where difficulty = 'hard'),
    'countries', count(distinct country),
    'continents', count(distinct continent)
  )
  from public.game_catalog
  where active;
$$;

-- ── Difficulty pool (mirrors src/utils/difficultyPool.ts) ───────────────────
-- The primary pool is the tier's own rows. If that cannot supply `p_needed`,
-- widen along the SAME fixed adjacency order the client uses, so server and
-- client selection cannot drift:
--   easy   → easy, normal, hard
--   normal → normal, easy, hard
--   hard   → hard, normal, easy
-- Returns the tier rank (0 = the requested tier) so callers can prefer it.
create or replace function public.roam_catalog_pool(
  p_difficulty text,
  p_needed int default 1
)
returns table (
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
  zoom double precision,
  tier_rank int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order text[];
  v_primary int;
begin
  if p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Invalid difficulty.';
  end if;

  v_order := case p_difficulty
    when 'easy' then array['easy', 'normal', 'hard']
    when 'normal' then array['normal', 'easy', 'hard']
    else array['hard', 'normal', 'easy']
  end;

  select count(*) into v_primary
    from public.game_catalog c
   where c.active and c.difficulty = p_difficulty;

  return query
    select c.location_id, c.group_id, c.pano_id, c.lat, c.lng, c.label, c.country,
           c.continent, c.difficulty, c.setting, c.heading, c.pitch, c.zoom,
           (array_position(v_order, c.difficulty) - 1)::int as tier_rank
      from public.game_catalog c
     where c.active
       -- Only widen when the tier genuinely cannot fill the request.
       and (c.difficulty = p_difficulty or v_primary < p_needed);
end;
$$;

-- ── Round selection (Diversity Engine, server side) ─────────────────────────
-- Returns `p_count` catalog rows as a jsonb array, applying the same ideas as
-- src/diversity/engine.ts:
--
--   1. hard exclusion  — never pick a group in `p_exclude_groups` (already used
--      inside this run / match).
--   2. cooldown        — deprioritise groups in `p_recent_groups` (the player's
--      or the room's recent history) but never fail because of them: freshness
--      is a preference, an empty round is not an option.
--   3. tier preference — the requested difficulty first, widening only when the
--      tier is too small (see roam_catalog_pool).
--   4. geographic spread — greedily avoid repeating a continent until every
--      continent in the candidate set has been used, then relax. This is what
--      stops a "world" game from being five European squares.
--
-- Randomness comes from `random()`, i.e. the server's PRNG, and the result is
-- never derived from a client-visible seed. Callers that need determinism for a
-- *stored* selection (the Daily Challenge) call this once inside a transaction
-- and persist the outcome; they never recompute it from a public input, because
-- a public seed would let anyone precompute tomorrow's answers.
--
-- SECURITY DEFINER with no grant: internal use only.
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
  delete from roam_sel_candidates;

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

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.roam_catalog_summary() from public, anon, authenticated;
revoke all on function public.roam_catalog_pool(text, int) from public, anon, authenticated;
revoke all on function public.roam_select_catalog_rounds(text, int, text[], text[])
  from public, anon, authenticated;

-- Only the aggregate summary is client-callable. The pool and the selector stay
-- server-only: they return coordinates.
grant execute on function public.roam_catalog_summary() to authenticated;

-- ============================================================================
-- Roam Engagement, Diversity & Game Modes V4 — durable per-player location
-- history (Diversity Engine V2, section 2.3).
--
-- INCREMENTAL migration on top of 0010. Purely additive: one new table, three
-- new RPCs, no changes to any existing table, function or policy. Nothing here
-- reads or writes rooms, solo runs, profiles or leaderboards, so applying it
-- cannot affect an active game.
--
-- WHY THIS EXISTS
-- The recent-location cooldown lived only in localStorage, so novelty reset to
-- zero on a reinstall, on a second device, or when a browser cleared site data
-- — and a player who had "seen everything" on their phone met all of it again
-- on their laptop. The local copy remains the offline / not-configured source
-- of truth and is still what selection reads synchronously; this table makes it
-- durable and shared across a player's devices.
--
-- WHAT IS STORED
-- Canonical *group* ids (see src/utils/canonicalGroup.ts), not location ids:
-- two catalog rows for one place occupy one slot. Group ids are opaque catalog
-- identifiers — they are not coordinates and reveal no answer.
--
-- PRIVACY / TRUST
--   • Identity always comes from auth.uid(); no caller-supplied user id.
--   • RLS restricts every row to its owner, AND all direct table privileges are
--     revoked from anon/authenticated so clients cannot read or write the table
--     at all — the RPCs below are the only door.
--   • Nothing here exposes another player's history, and no RPC returns a user
--     id to any caller.
-- ============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────

create table if not exists public.location_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Canonical group id from the catalog. Opaque; never a coordinate.
  group_id text not null,
  difficulty text not null default 'normal',
  collection text not null default 'world',
  mode text not null default 'solo',
  played_at timestamptz not null default now(),
  -- One row per (player, place): replaying a place moves its timestamp rather
  -- than growing the table, which is what keeps storage bounded.
  primary key (user_id, group_id),
  constraint location_history_group_id_len check (char_length(group_id) between 1 and 128),
  constraint location_history_collection_len check (char_length(collection) between 1 and 64),
  constraint location_history_difficulty_valid check (difficulty in ('easy', 'normal', 'hard')),
  -- Modes are listed explicitly so a typo cannot silently create a new bucket.
  -- Values beyond 'solo'/'endless'/'multiplayer' are accepted now so the modes
  -- added later in V4 need no further migration of this table.
  constraint location_history_mode_valid check (
    mode in ('solo', 'endless', 'multiplayer', 'daily', 'challenge', 'streak')
  )
);

-- Serves both the "newest N for this player" read and the bounded trim below.
create index if not exists idx_location_history_user_played
  on public.location_history (user_id, played_at desc);

-- Serves the opportunistic global cleanup of long-abandoned rows.
create index if not exists idx_location_history_played_at
  on public.location_history (played_at);

alter table public.location_history enable row level security;

-- Defence in depth. The grants below already deny all direct table access, but
-- if a future migration ever grants select, RLS still confines a caller to
-- their own rows.
drop policy if exists location_history_select_own on public.location_history;
create policy location_history_select_own on public.location_history
  for select using (user_id = auth.uid());

-- No insert/update/delete policies at all: clients never mutate this table
-- directly, only through the SECURITY DEFINER RPCs below.
revoke all on public.location_history from anon, authenticated;

-- ── Tunables ────────────────────────────────────────────────────────────────
-- Mirrors HISTORY_LIMIT_GROUPS in src/config/diversity.ts (250 groups ≈ 50
-- standard games). Kept as an immutable function so both the trim and the read
-- default cannot drift apart.
create or replace function public.roam_location_history_limit()
returns int
language sql
immutable
set search_path = public, pg_temp
as $$ select 250 $$;

revoke all on function public.roam_location_history_limit() from public;

-- ── Record ──────────────────────────────────────────────────────────────────
-- Called once per round, *after* the round has actually started — never at
-- selection time, so an abandoned game or a failed panorama lookup costs the
-- player no freshness. Replays move the timestamp; they never duplicate.
create or replace function public.roam_record_location_history(
  p_group_ids text[],
  p_difficulty text default 'normal',
  p_collection text default 'world',
  p_mode text default 'solo'
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := public.roam_location_history_limit();
  v_clean text[];
  v_recorded int := 0;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  -- Endless can finish a round every few seconds, so the burst window is
  -- generous; the sustained window is what actually bounds abuse.
  perform public.roam_check_rate_limit('roam_record_location_history:burst', 40, 60);
  perform public.roam_check_rate_limit('roam_record_location_history:sustained', 600, 3600);

  if p_group_ids is null or array_length(p_group_ids, 1) is null then
    return json_build_object('recorded', 0);
  end if;

  -- A round-level call sends one id; a batch reconciliation sends a handful.
  -- Anything larger is a client bug or an abuse attempt, not a real game.
  if array_length(p_group_ids, 1) > 25 then
    raise exception 'Too many locations in one call.';
  end if;

  -- Validate and de-duplicate before touching the table, so a single bad entry
  -- cannot poison the batch.
  select array_agg(distinct g)
    into v_clean
    from unnest(p_group_ids) as g
    where g is not null and char_length(g) between 1 and 128;

  if v_clean is null then
    return json_build_object('recorded', 0);
  end if;

  -- Argument validation is explicit rather than relying on the constraint, so
  -- the caller gets a clear error instead of a constraint violation string.
  if p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Unknown difficulty.';
  end if;
  if p_mode not in ('solo', 'endless', 'multiplayer', 'daily', 'challenge', 'streak') then
    raise exception 'Unknown mode.';
  end if;
  if p_collection is null or char_length(p_collection) not between 1 and 64 then
    raise exception 'Unknown collection.';
  end if;

  insert into public.location_history (user_id, group_id, difficulty, collection, mode, played_at)
  select v_uid, g, p_difficulty, p_collection, p_mode, now()
    from unnest(v_clean) as g
  on conflict (user_id, group_id) do update
    set played_at = excluded.played_at,
        difficulty = excluded.difficulty,
        collection = excluded.collection,
        mode = excluded.mode;

  get diagnostics v_recorded = row_count;

  -- Bounded trim: keep only the newest `v_limit` places for this player. The
  -- subquery is driven by idx_location_history_user_played, and the delete
  -- touches at most a handful of rows per call because the cap is only ever
  -- exceeded by what was just inserted.
  delete from public.location_history h
   where h.user_id = v_uid
     and h.group_id in (
       select group_id
         from public.location_history
        where user_id = v_uid
        order by played_at desc, group_id
        offset v_limit
     );

  -- Opportunistic, strictly bounded global cleanup — no pg_cron dependency,
  -- matching the pattern established by roam_check_rate_limit (0010). Rows
  -- this old belong to players who have not returned in a year.
  if random() < 0.01 then
    delete from public.location_history
     where ctid in (
       select ctid from public.location_history
        where played_at < now() - interval '365 days'
        limit 500
     );
  end if;

  return json_build_object('recorded', v_recorded);
end;
$$;

-- ── Read ────────────────────────────────────────────────────────────────────
-- Returns only the caller's own history, newest-first, as opaque group ids.
create or replace function public.roam_get_location_history(p_limit int default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(coalesce(p_limit, public.roam_location_history_limit()),
                       public.roam_location_history_limit());
begin
  if v_uid is null then
    -- Signed-out callers get an empty history rather than an error: solo play
    -- must keep working with no account and no backend.
    return json_build_object('groups', '[]'::json);
  end if;

  if v_limit < 1 then
    return json_build_object('groups', '[]'::json);
  end if;

  perform public.roam_check_rate_limit('roam_get_location_history', 60, 3600);

  return json_build_object(
    'groups',
    coalesce((
      select json_agg(group_id order by played_at desc, group_id)
        from (
          select group_id, played_at
            from public.location_history
           where user_id = v_uid
           order by played_at desc, group_id
           limit v_limit
        ) recent
    ), '[]'::json)
  );
end;
$$;

-- ── Reset ───────────────────────────────────────────────────────────────────
-- The server half of "Reset recently played locations". Deliberately explicit:
-- clearing local storage must never silently delete durable data.
create or replace function public.roam_reset_location_history()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted int := 0;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  perform public.roam_check_rate_limit('roam_reset_location_history', 5, 3600);

  delete from public.location_history where user_id = v_uid;
  get diagnostics v_deleted = row_count;
  return json_build_object('deleted', v_deleted);
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Revoke from everyone first, then grant only to authenticated. anon is never
-- granted: every caller signs in anonymously first (auth.uid() must exist).
revoke all on function public.roam_record_location_history(text[], text, text, text)
  from public, anon, authenticated;
revoke all on function public.roam_get_location_history(int) from public, anon, authenticated;
revoke all on function public.roam_reset_location_history() from public, anon, authenticated;

grant execute on function public.roam_record_location_history(text[], text, text, text)
  to authenticated;
grant execute on function public.roam_get_location_history(int) to authenticated;
grant execute on function public.roam_reset_location_history() to authenticated;

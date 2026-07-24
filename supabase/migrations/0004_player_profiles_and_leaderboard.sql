-- ============================================================================
-- Roam v2 — Persistent anonymous profiles, server-tracked solo runs, and the
-- weekly leaderboard result store.
--
-- INCREMENTAL migration. Adds new tables + RLS + the week helper. The RPCs that
-- write/read these tables live in 0005 (so match completion can record results
-- only after game_results exists). Nothing here touches 0001/0002/0003.
--
-- Trust model:
--   • Identity is always auth.uid() (anonymous Supabase session). Local storage
--     is only a display-name cache and is never trusted for authorization.
--   • Clients never write scores directly. Every result row is inserted by a
--     trusted SECURITY DEFINER function as part of authoritative completion.
--   • The public leaderboard exposes sanitized display names + stats only —
--     never auth UUIDs, emails, or tokens (see the read RPC in 0005).
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Week helper: Monday 00:00 UTC → next Monday 00:00 UTC ────────────────────
-- date_trunc('week') is ISO (Monday-based). We pin the calculation to UTC so
-- the week boundary is independent of the server session time zone.

create or replace function public.roam_week_start(p_ts timestamptz)
returns timestamptz
language sql
immutable
set search_path = pg_temp
as $$
  select (date_trunc('week', (p_ts at time zone 'UTC')) at time zone 'UTC');
$$;

create or replace function public.roam_week_end(p_ts timestamptz)
returns timestamptz
language sql
immutable
set search_path = pg_temp
as $$
  select public.roam_week_start(p_ts) + interval '7 days';
$$;

-- ── Player profiles (one per anonymous user) ────────────────────────────────

create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

drop trigger if exists trg_player_profiles_updated on public.player_profiles;
create trigger trg_player_profiles_updated
  before update on public.player_profiles
  for each row execute function public.mp_touch_updated_at();

-- ── Server-tracked solo runs (authoritative solo scoring) ───────────────────
-- The client renders panoramas but never sees a round's answer until it has
-- guessed that round. All reads go through SECURITY DEFINER RPCs (0005) that
-- omit the answer for un-guessed rounds — so these tables grant NO client
-- SELECT at all.

create table if not exists public.solo_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  total_rounds int not null check (total_rounds between 1 and 10),
  round_duration_seconds int not null check (round_duration_seconds between 15 and 600),
  status text not null default 'active'
    check (status in ('active', 'complete', 'abandoned')),
  current_round int not null default 1 check (current_round >= 1),
  total_score int not null default 0 check (total_score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  finalized_at timestamptz
);

create table if not exists public.solo_run_rounds (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.solo_runs (id) on delete cascade,
  round_number int not null check (round_number >= 1),
  pano_id text not null,
  heading double precision not null default 0,
  pitch double precision not null default 0,
  zoom double precision not null default 0,
  -- The answer. Hidden from clients until the round is guessed (RPC-gated).
  location_id text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  label text not null,
  country text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'complete')),
  started_at timestamptz,
  unique (run_id, round_number)
);

create table if not exists public.solo_run_guesses (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.solo_runs (id) on delete cascade,
  round_id uuid not null references public.solo_run_rounds (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  distance_km double precision not null check (distance_km >= 0),
  score int not null check (score >= 0),
  created_at timestamptz not null default now(),
  unique (round_id)
);

drop trigger if exists trg_solo_runs_updated on public.solo_runs;
create trigger trg_solo_runs_updated
  before update on public.solo_runs
  for each row execute function public.mp_touch_updated_at();

create index if not exists idx_solo_runs_user on public.solo_runs (user_id, status);
create index if not exists idx_solo_rounds_run on public.solo_run_rounds (run_id);
create index if not exists idx_solo_guesses_run on public.solo_run_guesses (run_id);

-- ── Game results (leaderboard-eligible completed games) ─────────────────────
-- One row per player per completed game. Written ONLY by trusted functions.

create table if not exists public.game_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('solo', 'multiplayer')),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  -- The originating game: solo run id, or multiplayer room id.
  game_id uuid not null,
  raw_score int not null check (raw_score >= 0),
  max_score int not null check (max_score > 0),
  round_count int not null check (round_count > 0),
  -- Multiplayer placement (1 = winner); solo is always 1.
  placement int not null default 1 check (placement >= 1),
  player_count int not null default 1 check (player_count >= 1),
  is_win boolean not null default false,
  is_tie boolean not null default false,
  completed_at timestamptz not null default now(),
  week_start timestamptz not null,
  -- Only eligible rows rank: exactly the standard round count, valid, complete.
  eligible boolean not null default true,
  -- One result per player per game — makes recording idempotent.
  unique (mode, game_id, user_id)
);

create index if not exists idx_results_week
  on public.game_results (week_start, mode, difficulty, eligible);
create index if not exists idx_results_user_week
  on public.game_results (user_id, week_start);

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.player_profiles enable row level security;
alter table public.solo_runs enable row level security;
alter table public.solo_run_rounds enable row level security;
alter table public.solo_run_guesses enable row level security;
alter table public.game_results enable row level security;

-- Profiles: only the owner may read their own full profile row. Writes are RPC
-- only (no insert/update/delete grants). The public leaderboard reads display
-- names through a SECURITY DEFINER function, never this policy.
drop policy if exists player_profiles_select_own on public.player_profiles;
create policy player_profiles_select_own on public.player_profiles
  for select to authenticated
  using (user_id = auth.uid());

-- Solo run tables: no direct client access at all. All reads/writes go through
-- SECURITY DEFINER RPCs so a round's answer is never selectable while pending.
-- (RLS is enabled with NO permissive policy → deny-all for clients.)

-- Game results: no direct client access. Reads go through the leaderboard RPC
-- (sanitized), writes through trusted completion functions.

-- ── Table privileges ────────────────────────────────────────────────────────

revoke all on public.player_profiles from anon, authenticated;
revoke all on public.solo_runs from anon, authenticated;
revoke all on public.solo_run_rounds from anon, authenticated;
revoke all on public.solo_run_guesses from anon, authenticated;
revoke all on public.game_results from anon, authenticated;

-- Only profiles get a (RLS-filtered) SELECT so a client can confirm its own
-- cached name. Everything else is strictly RPC-mediated.
grant select on public.player_profiles to authenticated;

revoke all on function public.roam_week_start(timestamptz) from public;
revoke all on function public.roam_week_end(timestamptz) from public;
grant execute on function public.roam_week_start(timestamptz) to authenticated;
grant execute on function public.roam_week_end(timestamptz) to authenticated;

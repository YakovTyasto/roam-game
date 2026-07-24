-- ============================================================================
-- Roam — Private multiplayer: schema, constraints, RLS, and Realtime.
--
-- This migration is safe to run in the Supabase SQL editor or via the CLI. It
-- contains NO secrets. All client writes go through the SECURITY DEFINER RPCs
-- in 0002_multiplayer_functions.sql; direct table writes are never granted.
--
-- Trust model (documented MVP limitation): the current round's panorama must be
-- rendered on both clients, so its pano id is necessarily readable by
-- participants. The target coordinates and the opponent's guess are withheld by
-- RLS until the round is complete. A technically sophisticated player could
-- still resolve a pano id back to coordinates via Google — perfect concealment
-- of the answer is impossible for a client-rendered panorama and is not claimed.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.multiplayer_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby'
    check (status in ('lobby', 'active', 'complete', 'abandoned')),
  current_round int not null default 0 check (current_round >= 0),
  total_rounds int not null default 5 check (total_rounds between 1 and 10),
  round_duration_seconds int not null default 120
    check (round_duration_seconds between 15 and 600),
  rematch_room_id uuid references public.multiplayer_rooms (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours'),
  constraint mp_rooms_code_format check (code ~ '^[A-Z0-9]{6}$')
);

create table if not exists public.multiplayer_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.multiplayer_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  slot smallint not null check (slot in (1, 2)),
  total_score int not null default 0 check (total_score >= 0),
  connection_status text not null default 'online'
    check (connection_status in ('online', 'offline', 'left')),
  joined_at timestamptz not null default now(),
  -- One membership per user per room (idempotent rejoin / multi-tab), and at
  -- most two slots — together these cap a room at two distinct players.
  unique (room_id, user_id),
  unique (room_id, slot)
);

create table if not exists public.multiplayer_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.multiplayer_rooms (id) on delete cascade,
  round_number int not null check (round_number >= 1),
  -- Render/orientation only — NOT the answer. Safe to read while playing.
  pano_id text not null,
  heading double precision not null default 0,
  pitch double precision not null default 0,
  zoom double precision not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'complete')),
  -- How many of the two players have submitted; lets a client show "opponent
  -- submitted" without reading the opponent's (hidden) guess.
  submitted_count int not null default 0 check (submitted_count between 0 and 2),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, round_number)
);

-- The secret answer for a round, kept in a separate table so RLS can reveal it
-- ONLY once the round is complete.
create table if not exists public.multiplayer_round_targets (
  round_id uuid primary key references public.multiplayer_rounds (id) on delete cascade,
  room_id uuid not null references public.multiplayer_rooms (id) on delete cascade,
  location_id text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  label text not null,
  country text not null
);

create table if not exists public.multiplayer_guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.multiplayer_rounds (id) on delete cascade,
  room_id uuid not null references public.multiplayer_rooms (id) on delete cascade,
  player_id uuid not null references public.multiplayer_players (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  distance_km double precision not null check (distance_km >= 0),
  score int not null check (score >= 0),
  created_at timestamptz not null default now(),
  -- Exactly one guess per player per round — prevents overwrites/duplicates.
  unique (round_id, player_id)
);

create index if not exists idx_mp_players_room on public.multiplayer_players (room_id);
create index if not exists idx_mp_rounds_room on public.multiplayer_rounds (room_id);
create index if not exists idx_mp_targets_room on public.multiplayer_round_targets (room_id);
create index if not exists idx_mp_guesses_room on public.multiplayer_guesses (room_id);
create index if not exists idx_mp_guesses_round on public.multiplayer_guesses (round_id);

-- ── updated_at maintenance ──────────────────────────────────────────────────

create or replace function public.mp_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mp_rooms_updated on public.multiplayer_rooms;
create trigger trg_mp_rooms_updated
  before update on public.multiplayer_rooms
  for each row execute function public.mp_touch_updated_at();

-- ── Participant check (used by RLS) ─────────────────────────────────────────
-- SECURITY DEFINER so it can read the players table without recursing through
-- RLS. Explicit, safe search_path.

create or replace function public.mp_is_participant(p_room_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.multiplayer_players
    where room_id = p_room_id
      and user_id = auth.uid()
  );
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.multiplayer_rooms enable row level security;
alter table public.multiplayer_players enable row level security;
alter table public.multiplayer_rounds enable row level security;
alter table public.multiplayer_round_targets enable row level security;
alter table public.multiplayer_guesses enable row level security;

-- Rooms: only participants may read their room. No client writes (RPC only).
drop policy if exists mp_rooms_select on public.multiplayer_rooms;
create policy mp_rooms_select on public.multiplayer_rooms
  for select to authenticated
  using (public.mp_is_participant(id));

-- Players: participants can see both players in their room.
drop policy if exists mp_players_select on public.multiplayer_players;
create policy mp_players_select on public.multiplayer_players
  for select to authenticated
  using (public.mp_is_participant(room_id));

-- Rounds: participants can read rounds that have started; pending (future)
-- rounds stay hidden so their panoramas can't be pre-studied.
drop policy if exists mp_rounds_select on public.multiplayer_rounds;
create policy mp_rounds_select on public.multiplayer_rounds
  for select to authenticated
  using (
    public.mp_is_participant(room_id)
    and status in ('active', 'complete')
  );

-- Targets (the answer): revealed only once the round is complete.
drop policy if exists mp_targets_select on public.multiplayer_round_targets;
create policy mp_targets_select on public.multiplayer_round_targets
  for select to authenticated
  using (
    public.mp_is_participant(room_id)
    and exists (
      select 1 from public.multiplayer_rounds r
      where r.id = round_id and r.status = 'complete'
    )
  );

-- Guesses: you always see your own; the opponent's is revealed only once the
-- round is complete (never before both submit or the timer expires).
drop policy if exists mp_guesses_select on public.multiplayer_guesses;
create policy mp_guesses_select on public.multiplayer_guesses
  for select to authenticated
  using (
    public.mp_is_participant(room_id)
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.multiplayer_rounds r
        where r.id = round_id and r.status = 'complete'
      )
    )
  );

-- ── Table privileges ────────────────────────────────────────────────────────
-- Deny everything by default; grant only SELECT to authenticated (RLS still
-- filters rows). No INSERT/UPDATE/DELETE grants: all mutations go through the
-- SECURITY DEFINER RPCs, so the publishable key alone cannot mutate data.

revoke all on public.multiplayer_rooms from anon, authenticated;
revoke all on public.multiplayer_players from anon, authenticated;
revoke all on public.multiplayer_rounds from anon, authenticated;
revoke all on public.multiplayer_round_targets from anon, authenticated;
revoke all on public.multiplayer_guesses from anon, authenticated;

grant select on public.multiplayer_rooms to authenticated;
grant select on public.multiplayer_players to authenticated;
grant select on public.multiplayer_rounds to authenticated;
grant select on public.multiplayer_round_targets to authenticated;
grant select on public.multiplayer_guesses to authenticated;

revoke all on function public.mp_is_participant(uuid) from public;
grant execute on function public.mp_is_participant(uuid) to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Add the tables to the supabase_realtime publication (idempotently). REPLICA
-- IDENTITY FULL ensures UPDATE/DELETE events carry room_id so client-side
-- filters (room_id=eq.…) match.

alter table public.multiplayer_rooms replica identity full;
alter table public.multiplayer_players replica identity full;
alter table public.multiplayer_rounds replica identity full;
alter table public.multiplayer_round_targets replica identity full;
alter table public.multiplayer_guesses replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'multiplayer_rooms',
    'multiplayer_players',
    'multiplayer_rounds',
    'multiplayer_round_targets',
    'multiplayer_guesses'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

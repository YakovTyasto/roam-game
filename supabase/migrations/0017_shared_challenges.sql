-- ============================================================================
-- Roam Engagement Core V5 — shareable, unlisted challenges.
--
-- INCREMENTAL migration on top of 0016. Additive: three new tables, new RPCs,
-- and one replacement of `roam_on_run_finalized` (the extension point introduced
-- in 0016 for exactly this) so a challenge attempt is stamped on completion.
-- No pre-V5 function is touched.
--
-- WHAT A SHARED CHALLENGE IS
-- A creator picks difficulty, 5 or 10 rounds, an optional round timer, a title
-- and an expiry. The SERVER picks the locations. Everyone who opens the link gets
-- the same locations in the same order, one official attempt each.
--
-- "UNLISTED" IS A REAL PROPERTY, NOT A LABEL
--   • There is no RPC that lists or searches challenges. The only way to reach one
--     is to know its code.
--   • Codes are 10 characters from a 31-symbol unambiguous alphabet (~10^15
--     combinations), so enumeration is not a practical attack — and creation and
--     lookup are both rate-limited on top of that.
--   • A lookup for an unknown, expired, or well-formed-but-nonexistent code
--     returns the same shaped response, so probing tells an attacker nothing
--     beyond "not playable".
--
-- WHAT THE CREATOR CANNOT DO
-- Supply coordinates, pano ids, or a location list. The creation RPC takes
-- configuration only. A creator therefore does not know their own challenge's
-- answers until they play it, exactly like everyone else.
-- ============================================================================

-- ── Code generation ─────────────────────────────────────────────────────────
-- Same unambiguous alphabet as room codes (no 0/O/1/I/L), but 10 characters
-- rather than 6: a room code is typed by a friend in the same room and lives for
-- minutes, while a challenge code is a public URL that lives for days.
create or replace function public.roam_gen_challenge_code()
returns text
language plpgsql
volatile
set search_path = pg_temp
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := '';
  i int;
begin
  for i in 1..10 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- ── Title sanitisation ──────────────────────────────────────────────────────
-- A challenge title is the one piece of *player-authored text* in this feature
-- that other players see, so it is cleaned server-side and never trusted from the
-- client. Same rules as display names (mp_clean_name) plus a longer clamp:
-- strip control characters and angle brackets, collapse whitespace, trim, cap.
create or replace function public.roam_clean_challenge_title(p_title text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select left(
    btrim(
      regexp_replace(
        -- Strip whole tag-like runs first. Removing only the angle brackets
        -- (what mp_clean_name does for short display names) would turn
        -- "<b>Trip</b>" into the nonsense "bTrip/b" rather than "Trip".
        regexp_replace(
          regexp_replace(coalesce(p_title, ''), '<[^>]*>', '', 'g'),
          -- Angle brackets and non-whitespace control characters go entirely.
          -- Tab/newline/CR are deliberately NOT in this class: they are
          -- whitespace, and deleting them would run words together
          -- ("one\ntwo" → "onetwo") instead of separating them.
          '[<>\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    60
  );
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.shared_challenges (
  code text primary key check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$'),
  creator_id uuid not null references auth.users (id) on delete cascade,
  -- Already sanitised on the way in; the constraint is a backstop.
  title text not null default '' check (char_length(title) <= 60),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  round_count int not null check (round_count in (5, 10)),
  -- null = no round timer.
  timer_seconds int check (timer_seconds is null or timer_seconds between 15 and 600),
  created_at timestamptz not null default now(),
  -- Always set. The default is applied by the create RPC, so a challenge can
  -- never be immortal by omission.
  expires_at timestamptz not null
);

create index if not exists idx_shared_challenges_creator
  on public.shared_challenges (creator_id, created_at desc);
create index if not exists idx_shared_challenges_expiry
  on public.shared_challenges (expires_at);

create table if not exists public.shared_challenge_rounds (
  code text not null references public.shared_challenges (code) on delete cascade,
  round_number int not null check (round_number >= 1),
  location_id text not null,
  group_id text not null,
  pano_id text not null,
  heading double precision not null default 0,
  pitch double precision not null default 0,
  zoom double precision not null default 0,
  -- The answers. Never selectable by a client.
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  label text not null,
  country text not null,
  primary key (code, round_number),
  unique (code, group_id)
);

create table if not exists public.shared_challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.shared_challenges (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.solo_runs (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'complete', 'abandoned')),
  total_score int not null default 0 check (total_score >= 0),
  total_distance_km double precision not null default 0 check (total_distance_km >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  -- One official attempt per player per challenge, as a constraint.
  unique (code, user_id)
);

create index if not exists idx_challenge_attempts_board
  on public.shared_challenge_attempts (code, status, total_score desc);
create unique index if not exists uq_challenge_attempts_run
  on public.shared_challenge_attempts (run_id);

-- ── RLS + privileges ────────────────────────────────────────────────────────
alter table public.shared_challenges enable row level security;
alter table public.shared_challenge_rounds enable row level security;
alter table public.shared_challenge_attempts enable row level security;

revoke all on public.shared_challenges from anon, authenticated;
revoke all on public.shared_challenge_rounds from anon, authenticated;
revoke all on public.shared_challenge_attempts from anon, authenticated;

-- Defence in depth for a future grant. Note there is deliberately no policy on
-- shared_challenges: not even "read any challenge by code" is allowed directly,
-- because that would turn the table into the searchable list this feature must
-- not have.
drop policy if exists challenge_attempts_select_own on public.shared_challenge_attempts;
create policy challenge_attempts_select_own on public.shared_challenge_attempts
  for select using (user_id = auth.uid());

-- ── Create ──────────────────────────────────────────────────────────────────
create or replace function public.roam_create_challenge_v2(
  p_difficulty text default 'normal',
  p_round_count int default 5,
  p_timer_seconds int default null,
  p_title text default '',
  p_expires_hours int default 168
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_title text;
  v_expires timestamptz;
  v_selected jsonb;
  v_elem jsonb;
  v_attempts int := 0;
  i int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  -- Creation is the expensive, abusable direction (it writes a row set each
  -- time), so it is the more tightly limited one.
  perform public.roam_check_rate_limit('roam_create_challenge:burst', 3, 60);
  perform public.roam_check_rate_limit('roam_create_challenge:sustained', 20, 3600);

  if p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Invalid difficulty.';
  end if;
  if p_round_count not in (5, 10) then
    raise exception 'A challenge is 5 or 10 rounds.';
  end if;
  if p_timer_seconds is not null and (p_timer_seconds < 15 or p_timer_seconds > 600) then
    raise exception 'Invalid round timer.';
  end if;
  -- Bounded expiry with a safe default: an hour at minimum, 30 days at most.
  if p_expires_hours is null or p_expires_hours < 1 or p_expires_hours > 720 then
    raise exception 'Invalid expiry.';
  end if;

  v_title := public.roam_clean_challenge_title(p_title);
  v_expires := now() + make_interval(hours => p_expires_hours);

  -- The server picks the locations. The creator sends no coordinates at all, and
  -- their own recent history is used as a cooldown just like any other run.
  v_selected := public.roam_select_catalog_rounds(
    p_difficulty, p_round_count, '{}', public.roam_recent_groups_for(v_uid)
  );

  loop
    v_attempts := v_attempts + 1;
    v_code := public.roam_gen_challenge_code();
    begin
      insert into public.shared_challenges
        (code, creator_id, title, difficulty, round_count, timer_seconds, expires_at)
      values (v_code, v_uid, v_title, p_difficulty, p_round_count, p_timer_seconds, v_expires);
      exit;
    exception when unique_violation then
      if v_attempts >= 10 then
        raise exception 'Could not allocate a challenge code. Please try again.';
      end if;
    end;
  end loop;

  for i in 0 .. jsonb_array_length(v_selected) - 1 loop
    v_elem := v_selected -> i;
    insert into public.shared_challenge_rounds
      (code, round_number, location_id, group_id, pano_id, heading, pitch, zoom,
       lat, lng, label, country)
    values (
      v_code, i + 1,
      v_elem ->> 'location_id',
      v_elem ->> 'group_id',
      v_elem ->> 'pano_id',
      coalesce((v_elem ->> 'heading')::double precision, 0),
      coalesce((v_elem ->> 'pitch')::double precision, 0),
      coalesce((v_elem ->> 'zoom')::double precision, 0),
      (v_elem ->> 'lat')::double precision,
      (v_elem ->> 'lng')::double precision,
      v_elem ->> 'label',
      v_elem ->> 'country'
    );
  end loop;

  return json_build_object(
    'code', v_code,
    'title', v_title,
    'difficulty', p_difficulty,
    'round_count', p_round_count,
    'timer_seconds', p_timer_seconds,
    'expires_at', v_expires
  );
end;
$$;

-- ── Look up a challenge by code ─────────────────────────────────────────────
-- Returns configuration and the caller's own attempt state. Never rounds, never
-- another player's identity.
--
-- Unknown / malformed / expired all produce the same shape (`playable: false`
-- plus a reason), so a prober learns only that a code is not playable.
create or replace function public.roam_get_challenge_v2(p_code text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_ch public.shared_challenges;
  v_attempt public.shared_challenge_attempts;
  v_players int := 0;
begin
  if v_uid is not null then
    -- Looking up costs a database read, so it is limited too — generously,
    -- because a legitimate player may open the same link several times.
    perform public.roam_check_rate_limit('roam_get_challenge', 120, 3600);
  end if;

  if v_code !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$' then
    return json_build_object('playable', false, 'reason', 'not_found');
  end if;

  select * into v_ch from public.shared_challenges where code = v_code;
  if not found then
    return json_build_object('playable', false, 'reason', 'not_found');
  end if;
  if v_ch.expires_at <= now() then
    -- Expired is reported distinctly ONLY once the code is known to exist: it is
    -- useful to a real player ("this link is old") and reveals nothing new, since
    -- they already hold a valid code.
    return json_build_object('playable', false, 'reason', 'expired',
      'title', v_ch.title, 'expires_at', v_ch.expires_at);
  end if;

  if v_uid is not null then
    select * into v_attempt from public.shared_challenge_attempts
      where code = v_code and user_id = v_uid;
  end if;

  select count(*) into v_players from public.shared_challenge_attempts
   where code = v_code and status = 'complete';

  return json_build_object(
    'playable', true,
    'reason', 'ok',
    'code', v_ch.code,
    'title', v_ch.title,
    'difficulty', v_ch.difficulty,
    'round_count', v_ch.round_count,
    'timer_seconds', v_ch.timer_seconds,
    'expires_at', v_ch.expires_at,
    'created_at', v_ch.created_at,
    'server_now', now(),
    'is_creator', (v_uid is not null and v_uid = v_ch.creator_id),
    'creator_name', coalesce(
      (select display_name from public.player_profiles where user_id = v_ch.creator_id),
      'Player'
    ),
    'players_completed', v_players,
    'attempt', case when v_attempt.id is null then null else json_build_object(
      'status', v_attempt.status,
      'total_score', v_attempt.total_score,
      'total_distance_km', v_attempt.total_distance_km,
      'duration_ms', v_attempt.duration_ms,
      'completed_at', v_attempt.completed_at,
      'rounds_played', (
        select count(*) from public.solo_run_rounds
         where run_id = v_attempt.run_id and status = 'complete'
      )
    ) end
  );
end;
$$;

-- ── Start / resume an attempt ───────────────────────────────────────────────
create or replace function public.roam_start_challenge_v2(p_code text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_ch public.shared_challenges;
  v_attempt public.shared_challenge_attempts;
  v_run public.solo_runs;
  v_rounds jsonb;
  v_duration int;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  perform public.roam_check_rate_limit('roam_start_challenge:burst', 10, 60);
  perform public.roam_check_rate_limit('roam_start_challenge:sustained', 60, 3600);

  select * into v_ch from public.shared_challenges where code = v_code;
  if not found then
    raise exception 'That challenge could not be found.';
  end if;
  if v_ch.expires_at <= now() then
    raise exception 'That challenge has expired.';
  end if;

  select * into v_attempt from public.shared_challenge_attempts
    where code = v_code and user_id = v_uid
    for update;

  if found and v_attempt.status = 'complete' then
    return json_build_object(
      'started', false,
      'reason', 'already_completed',
      'code', v_code,
      'total_score', v_attempt.total_score
    );
  end if;

  if found and v_attempt.status = 'active' then
    return json_build_object(
      'started', true, 'resumed', true, 'code', v_code,
      'run', public.roam_run_payload(v_attempt.run_id)
    );
  end if;

  update public.solo_runs set status = 'abandoned', updated_at = now()
    where user_id = v_uid and status = 'active';

  -- No timer means "no countdown" in the UI, but a run row still needs a
  -- duration; use the difficulty default so a round can still expire rather than
  -- pinning a run open forever.
  v_duration := coalesce(v_ch.timer_seconds, public.mp_difficulty_duration(v_ch.difficulty));

  insert into public.solo_runs
    (user_id, difficulty, total_rounds, round_duration_seconds, current_round,
     mode, server_selected)
  values (v_uid, v_ch.difficulty, v_ch.round_count, v_duration, 1, 'challenge', true)
  returning * into v_run;

  select jsonb_agg(jsonb_build_object(
           'location_id', r.location_id,
           'group_id', r.group_id,
           'pano_id', r.pano_id,
           'heading', r.heading,
           'pitch', r.pitch,
           'zoom', r.zoom,
           'lat', r.lat,
           'lng', r.lng,
           'label', r.label,
           'country', r.country
         ) order by r.round_number)
    into v_rounds
    from public.shared_challenge_rounds r
   where r.code = v_code;

  perform public.roam_write_run_rounds(v_run.id, v_rounds, v_duration);

  insert into public.shared_challenge_attempts (code, user_id, run_id)
  values (v_code, v_uid, v_run.id);

  return json_build_object(
    'started', true, 'resumed', false, 'code', v_code,
    'has_timer', (v_ch.timer_seconds is not null),
    'run', public.roam_run_payload(v_run.id)
  );
end;
$$;

-- ── Finalization hook (replaces the 0016 version, adding challenges) ────────
create or replace function public.roam_on_run_finalized(
  p_run_id uuid,
  p_uid uuid,
  p_mode text,
  p_total_score int,
  p_total_distance double precision
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Daily (0016).
  update public.daily_attempts a
     set status = 'complete',
         total_score = p_total_score,
         total_distance_km = p_total_distance,
         completed_at = now(),
         duration_ms = greatest(0, (extract(epoch from (now() - a.started_at)) * 1000)::bigint)
   where a.run_id = p_run_id
     and a.user_id = p_uid
     and a.status = 'active';

  -- Shared challenges. Same shape, same exactly-once guard: the `status =
  -- 'active'` predicate is what makes a replayed finalize a no-op.
  update public.shared_challenge_attempts a
     set status = 'complete',
         total_score = p_total_score,
         total_distance_km = p_total_distance,
         completed_at = now(),
         duration_ms = greatest(0, (extract(epoch from (now() - a.started_at)) * 1000)::bigint)
   where a.run_id = p_run_id
     and a.user_id = p_uid
     and a.status = 'active';
end;
$$;

-- ── Challenge leaderboard ───────────────────────────────────────────────────
-- Same sanitisation and the same documented tie-break order as the Daily board:
-- score, then total distance, then duration, then completion time. No user ids.
create or replace function public.roam_challenge_leaderboard(
  p_code text,
  p_limit int default 50
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_entries json;
  v_self json;
begin
  if v_uid is not null then
    perform public.roam_check_rate_limit('roam_challenge_leaderboard', 120, 3600);
  end if;

  -- An unknown code returns an empty board rather than an error: the UI shows
  -- "nobody has played yet" for a brand-new challenge, and a prober cannot tell
  -- the two situations apart.
  with ranked as (
    select a.user_id, a.total_score, a.total_distance_km, a.duration_ms, a.completed_at,
           coalesce(p.display_name, 'Player') as display_name,
           row_number() over (
             order by a.total_score desc,
                      a.total_distance_km asc,
                      a.duration_ms asc nulls last,
                      a.completed_at asc,
                      a.user_id asc
           ) as rnk
      from public.shared_challenge_attempts a
      left join public.player_profiles p on p.user_id = a.user_id
     where a.code = v_code and a.status = 'complete'
  )
  select
    coalesce((
      select json_agg(json_build_object(
        'rank', rnk,
        'display_name', display_name,
        'total_score', total_score,
        'total_distance_km', total_distance_km,
        'duration_ms', duration_ms,
        'completed_at', completed_at,
        'is_self', (user_id = v_uid)
      ) order by rnk)
      from (select * from ranked order by rnk limit v_limit) top
    ), '[]'::json),
    (
      select json_build_object(
        'rank', rnk, 'display_name', display_name, 'total_score', total_score,
        'total_distance_km', total_distance_km, 'duration_ms', duration_ms,
        'completed_at', completed_at, 'is_self', true
      )
      from ranked where user_id = v_uid
    )
  into v_entries, v_self;

  return json_build_object(
    'code', v_code,
    'entries', v_entries,
    'self', v_self,
    'server_now', now()
  );
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.roam_gen_challenge_code() from public, anon, authenticated;
revoke all on function public.roam_clean_challenge_title(text) from public, anon, authenticated;
revoke all on function public.roam_create_challenge_v2(text, int, int, text, int)
  from public, anon, authenticated;
revoke all on function public.roam_get_challenge_v2(text) from public, anon, authenticated;
revoke all on function public.roam_start_challenge_v2(text) from public, anon, authenticated;
revoke all on function public.roam_challenge_leaderboard(text, int)
  from public, anon, authenticated;
revoke all on function public.roam_on_run_finalized(uuid, uuid, text, int, double precision)
  from public, anon, authenticated;

grant execute on function public.roam_create_challenge_v2(text, int, int, text, int) to authenticated;
grant execute on function public.roam_get_challenge_v2(text) to authenticated;
grant execute on function public.roam_start_challenge_v2(text) to authenticated;
grant execute on function public.roam_challenge_leaderboard(text, int) to authenticated;

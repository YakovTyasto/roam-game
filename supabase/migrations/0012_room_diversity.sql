-- ============================================================================
-- Roam Engagement, Diversity & Game Modes V4 — room-wide location novelty
-- (Diversity Engine V2, section 2.4).
--
-- INCREMENTAL migration on top of 0011. Purely additive: one new RPC. No table,
-- policy, grant or existing function is changed.
--
-- WHY
-- Multiplayer selection is host-authoritative, so a match avoided only the
-- *host's* recent places. Everyone else could be shown somewhere they had just
-- played solo. This RPC lets the host weight selection by what the room as a
-- whole has seen recently, without ever learning who saw what.
--
-- PRIVACY MODEL — read this before changing the shape of the response
-- A participant can always diff any room-wide aggregate against their own
-- knowledge, so the aggregate is built to make *attribution* impossible rather
-- than to pretend no information flows:
--
--   1. The caller's own rows are excluded. The caller already knows their own
--      history (it is in their local cache), so including it would add nothing
--      but would let them subtract it back out.
--   2. The RPC is a no-op below `v_min_participants` (3) players. With only one
--      other participant, every entry in the aggregate would be attributable to
--      that single person. Two-player rooms therefore fall back to host-only
--      history — an honest, documented limitation, not a silent one.
--   3. No user id is returned, ever. `seen_by` is a count over the *other*
--      participants, so the finest granularity a caller can reach is "k of the
--      others", never "this player".
--
-- Nothing here exposes a coordinate, a label, or a future target: group ids are
-- opaque catalog identifiers, and the rows come from location_history, which
-- only ever records places that were already played.
-- ============================================================================

create or replace function public.roam_room_recent_groups(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  -- Below this many participants, an entry in the aggregate would identify a
  -- specific player. See the privacy model above.
  v_min_participants constant int := 3;
  -- Bounded response: 500 places is far more than any pool the selector will
  -- rank against, and keeps the payload small on a lobby screen.
  v_max_groups constant int := 500;
  v_participants int;
  v_others int;
  v_groups json;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  perform public.roam_check_rate_limit('roam_room_recent_groups', 30, 3600);

  -- Membership check: only an active participant of this room may ask. A
  -- non-participant learns nothing, not even that the room exists.
  if not exists (
    select 1 from public.multiplayer_players
     where room_id = p_room_id and user_id = v_uid and connection_status <> 'left'
  ) then
    raise exception 'You are not in this room.';
  end if;

  select count(*) into v_participants
    from public.multiplayer_players
   where room_id = p_room_id and connection_status <> 'left';

  v_others := v_participants - 1;

  if v_participants < v_min_participants then
    -- Not enough players to anonymise the aggregate. Report it explicitly so
    -- the client can fall back to host-only history rather than guessing.
    return json_build_object(
      'applied', false,
      'reason', 'too_few_participants',
      'participants_considered', 0,
      'groups', '[]'::json
    );
  end if;

  select coalesce(json_agg(row_to_json(g) order by g.last_played_at desc, g.group_id), '[]'::json)
    into v_groups
    from (
      select h.group_id,
             count(*)::int as seen_by,
             max(h.played_at) as last_played_at
        from public.location_history h
        join public.multiplayer_players p
          on p.user_id = h.user_id
         and p.room_id = p_room_id
         and p.connection_status <> 'left'
       where h.user_id <> v_uid
       group by h.group_id
       order by max(h.played_at) desc, h.group_id
       limit v_max_groups
    ) g;

  return json_build_object(
    'applied', true,
    'reason', 'ok',
    -- How many *other* participants the counts range over. Lets the client
    -- normalise `seen_by` without ever seeing an identity.
    'participants_considered', v_others,
    'groups', v_groups
  );
end;
$$;

revoke all on function public.roam_room_recent_groups(uuid) from public, anon, authenticated;
grant execute on function public.roam_room_recent_groups(uuid) to authenticated;

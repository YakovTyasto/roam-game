-- ============================================================================
-- Roam Foundation & Gameplay Polish V3 — explicit solo run abandonment.
--
-- INCREMENTAL migration. Adds a small RPC so the client's exit flow can mark
-- an active solo run abandoned immediately (rather than relying on the
-- 12-hour expiry, or waiting for the next roam_create_solo_run call's
-- implicit "abandon any earlier active run"). Abandoning never writes a
-- game_results row — only roam_finalize_solo_run does that, and an abandoned
-- run is never finalized — so this cannot create a leaderboard result. It
-- touches only solo_runs.status; profile, best score, theme, and location
-- history are untouched.
-- ============================================================================

create or replace function public.roam_abandon_solo_run(p_run_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated boolean;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  update public.solo_runs
    set status = 'abandoned', updated_at = now()
    where id = p_run_id and user_id = v_uid and status = 'active';

  v_updated := found;
  -- Idempotent: calling this twice (or after the run already finished) is a
  -- harmless no-op, not an error — matches roam_finalize_solo_run's pattern.
  return json_build_object('ok', true, 'abandoned', v_updated);
end;
$$;

revoke all on function public.roam_abandon_solo_run(uuid) from public;
grant execute on function public.roam_abandon_solo_run(uuid) to authenticated;

-- ============================================================================
-- Roam Foundation & Gameplay Polish V3 — wire up solo run resume.
--
-- INCREMENTAL migration. roam_get_active_solo_run() (0005) already existed
-- but was never called from the UI, and was missing the one field a client
-- needs to restore the timer without trusting its own clock: each round's
-- `started_at`. Adds that plus a `server_now` anchor, both read-only and
-- additive to the existing JSON shape. Same signature (no args) — safe to
-- CREATE OR REPLACE in place.
--
-- Still hides lat/lng/label/country for any round that isn't 'complete' —
-- this migration does not weaken that guarantee. A resumed *pending* round is
-- rendered from pano_id/heading/pitch/zoom alone (already unconditionally
-- returned), exactly like multiplayer already does — see
-- src/screens/multiplayer/MultiplayerGame.tsx for the precedent.
-- ============================================================================

create or replace function public.roam_get_active_solo_run()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_run public.solo_runs;
begin
  if v_uid is null then
    return json_build_object('active', false);
  end if;

  select * into v_run from public.solo_runs
    where user_id = v_uid and status = 'active'
    order by created_at desc
    limit 1;
  if not found then
    return json_build_object('active', false);
  end if;

  return json_build_object(
    'active', true,
    'run_id', v_run.id,
    'difficulty', v_run.difficulty,
    'total_rounds', v_run.total_rounds,
    'round_duration_seconds', v_run.round_duration_seconds,
    'current_round', v_run.current_round,
    'total_score', v_run.total_score,
    'server_now', now(),
    'expires_at', v_run.expires_at,
    'rounds', coalesce((
      select json_agg(json_build_object(
        'round_number', r.round_number,
        'location_id', r.location_id,
        'pano_id', r.pano_id,
        'heading', r.heading,
        'pitch', r.pitch,
        'zoom', r.zoom,
        'status', r.status,
        'started_at', r.started_at,
        -- Reveal the answer + guess only for completed rounds.
        'label', case when r.status = 'complete' then r.label else null end,
        'country', case when r.status = 'complete' then r.country else null end,
        'lat', case when r.status = 'complete' then r.lat else null end,
        'lng', case when r.status = 'complete' then r.lng else null end,
        'guess_lat', g.lat,
        'guess_lng', g.lng,
        'distance_km', g.distance_km,
        'score', g.score
      ) order by r.round_number)
      from public.solo_run_rounds r
      left join public.solo_run_guesses g on g.round_id = r.id
      where r.run_id = v_run.id
    ), '[]'::json)
  );
end;
$$;

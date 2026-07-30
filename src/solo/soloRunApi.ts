import { getSupabase } from '../multiplayer/supabaseClient';
import { withTimeout } from '../utils/withTimeout';

/**
 * What is left of the pre-V5 solo-run client API.
 *
 * Starting, submitting, reading and finalizing a run all moved to
 * `src/official/officialRunApi.ts` (server-selected rounds, answers held by the
 * server). Abandonment did not move: `roam_abandon_solo_run` works on any row in
 * `solo_runs` regardless of how it was created, only flips a status, and can
 * never produce a score — so there was nothing to version.
 *
 * The legacy RPCs this module used to call (`roam_create_solo_run`,
 * `roam_submit_solo_guess`, `roam_get_active_solo_run`,
 * `roam_finalize_solo_run`) are all still present and granted in the database on
 * purpose: migrations deploy before the frontend, so a client running the
 * previous release must keep working against the migrated schema. See
 * docs/ENGAGEMENT_CORE_V5.md for the later release that removes them.
 */

const ABANDON_TIMEOUT_MS = 8000;

/** Explicitly abandon an active run (exit flow). Idempotent; never scores. */
export async function abandonSoloRun(runId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await withTimeout(
    supabase.rpc('roam_abandon_solo_run', { p_run_id: runId }),
    ABANDON_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
}

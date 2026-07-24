/**
 * Server-authoritative round timer helpers (pure).
 *
 * The client renders a countdown, but the DATABASE is the authority on whether
 * a round has actually expired: `mp_expire_round` re-checks `now() >=
 * started_at + duration` server-side before locking the round, so a client
 * cannot expire a round early by fast-forwarding its local clock.
 *
 * To keep the displayed countdown honest despite clock skew, the client
 * estimates server time as `Date.now() + serverOffsetMs`, where the offset is
 * measured once against `mp_server_now()`.
 */

/** Milliseconds of server time that have elapsed since the round started. */
function elapsedMs(startedAtMs: number, serverNowMs: number): number {
  return serverNowMs - startedAtMs;
}

/**
 * Whole seconds remaining in the round, clamped to [0, duration]. Returns
 * `durationSeconds` if the round has no start time yet.
 */
export function remainingSeconds(
  startedAtMs: number | null,
  durationSeconds: number,
  serverNowMs: number,
): number {
  if (startedAtMs === null) return durationSeconds;
  const remainingMs = durationSeconds * 1000 - elapsedMs(startedAtMs, serverNowMs);
  const remaining = Math.ceil(remainingMs / 1000);
  return Math.max(0, Math.min(durationSeconds, remaining));
}

/**
 * Whether the round is expired according to server time. Mirrors the SQL guard
 * exactly (>= duration). A small negative skew tolerance is intentionally NOT
 * applied on the client: the client only *proposes* expiry and the server has
 * the final say, so proposing a touch early is harmless (the RPC will reject
 * it and the client retries on the next tick).
 */
export function isRoundExpired(
  startedAtMs: number | null,
  durationSeconds: number,
  serverNowMs: number,
): boolean {
  if (startedAtMs === null) return false;
  return elapsedMs(startedAtMs, serverNowMs) >= durationSeconds * 1000;
}

/** Convert an ISO timestamp to epoch ms, or null if absent/unparseable. */
export function toEpochMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

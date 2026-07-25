# Anti-abuse: server-side rate limiting

Real protection lives in the database (`supabase/migrations/0010_rate_limiting.sql`),
not just client-side UI throttling — a client can always be bypassed, so every
guarantee here is enforced by Postgres itself.

## How it works

- `public.rate_limits(user_id, action, bucket_start, count)` — a fixed-window
  counter. `roam_check_rate_limit(p_action, p_limit, p_window_seconds)` upserts
  the caller's bucket (identity always from `auth.uid()`, never a client-supplied
  id) and raises `RATE_LIMITED: <action> (max N per Ws)` once the count for the
  current window is exceeded.
- **Not client-callable.** `roam_check_rate_limit` has no grant to
  `authenticated`/`anon` — it's only ever invoked from inside another
  `SECURITY DEFINER` function, which runs with the function owner's
  privileges. A client cannot call it directly, reset it, or read another
  user's state (RLS is enabled on `rate_limits` with zero permissive
  policies — deny-all for clients).
- **Burst + sustained limits** are two independent calls with different
  windows, e.g. `roam_check_rate_limit('mp_create_room:burst', 3, 60)` *and*
  `roam_check_rate_limit('mp_create_room:sustained', 15, 3600)` — both must
  pass.
- **Bounded storage.** ~1% of calls also delete buckets older than an hour,
  so the table never grows unbounded without needing a `pg_cron` job.
- **Stable client-facing errors.** Every rejection starts with the literal
  prefix `RATE_LIMITED:`. `src/utils/rateLimit.ts#isRateLimitedError` detects
  it without depending on exact wording, and
  `toFriendlyErrorMessage`/`friendlyRateLimitMessage` map it to a stable,
  user-friendly string ("You're doing that too often — please wait a moment
  and try again.") wherever RPC errors are surfaced (wired into
  `useProfile`'s save-name flow and `useMultiplayer`'s shared `errorMessage`
  helper, covering room creation/join/start/submit/leave/rematch).
- **Normal usage stays smooth.** Limits are per-user and per-action, so
  legitimate multi-tab use, reconnects, and idempotent retries (already
  idempotent at the RPC level — see the exit-flow and resume docs) aren't
  penalized; only genuinely repeated calls to the *same* action within the
  window count against the limit.

## What's wired today

| RPC | Burst | Sustained |
|---|---|---|
| `roam_upsert_profile` (profile creation/update) | 5 / 60s | 20 / 3600s |
| `mp_create_room` (room creation) | 3 / 60s | 15 / 3600s |
| `roam_create_solo_run` (solo run creation) | 5 / 60s | 20 / 3600s |
| `roam_abandon_solo_run` | — | 20 / 3600s |

These four were chosen as a complete, carefully-reviewed proof of the
pattern — each was re-verified end-to-end against a real local Postgres
instance (`supabase/tests/06_rate_limit_verify.sql`, migrations
0001→0010 applied in order) covering: allowed usage under the limit, burst
rejection with a stable error, cooldown recovery once the window elapses,
and cross-user isolation in both directions, plus a concrete proof that
`mp_create_room` itself (not just the generic helper) is protected.

## Documented follow-up (not wired in this pass)

The same two-line pattern (`perform public.roam_check_rate_limit(...)` as the
first statement in the function body, then `CREATE OR REPLACE FUNCTION` with
an unchanged signature) applies directly to the remaining sensitive RPCs the
spec calls out:

- `mp_join_room` (room joining attempts)
- `mp_start_match` (match start)
- `mp_submit_guess` / `roam_submit_solo_guess` (guess submission)
- `mp_expire_round` / `mp_advance_round` (round advance/expiry)
- `mp_leave_room` (already idempotent and cheap, but still worth a generous
  sustained limit against a scripted leave/rejoin loop)
- `roam_finalize_solo_run` (result finalization — already idempotent, but a
  limit adds defense in depth)

These were deliberately left unwired in this pass rather than blindly
re-pasting large, previously-verified function bodies (some over 60 lines)
without re-deriving and re-testing every branch — the four wired above were
ones already fully re-read and verified in this session's context. Wiring
the rest is mechanical but should be done function-by-function with the same
local-Postgres verification loop used for 0006–0010, not as one large,
harder-to-review diff.

No telemetry/error-reporting RPC exists yet in this codebase to rate-limit
(see the error-handling foundation work) — once one is added, apply the
same pattern to it too.

## CAPTCHA

See [`CAPTCHA_SETUP.md`](./CAPTCHA_SETUP.md) for the separate, optional
Cloudflare Turnstile integration on the anonymous sign-in bootstrap, and why
it complements — but cannot replace — the rate limiting above.

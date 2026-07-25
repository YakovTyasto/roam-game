# Operations guide

Practical guidance for running Roam in production: where to look when
something breaks, what to monitor day-to-day, and how to roll back.

## Error handling architecture

- **`src/components/ErrorBoundary.tsx`** — a top-level React error boundary
  wraps the whole app (`src/main.tsx`). A render/lifecycle error shows a
  friendly "Something went wrong" screen with a Reload button instead of a
  blank page.
- **`src/errors/normalize.ts`** — every caught error (RPC failures, network
  errors, thrown exceptions) is passed through `normalizeError()`, which maps
  it to a stable `ErrorCode` (`offline`, `rate_limited`, `auth_unavailable`,
  `not_configured`, `not_found`, `validation`, `server_rejected`, `unknown`)
  plus a `userMessage` safe to show a player and a `devMessage` safe to log.
- **`src/errors/report.ts`** — provider-neutral reporting. Today: console
  logging in development, silent in production (no vendor configured). To
  connect a provider (Sentry, etc.) later, replace the body of `reportError`
  with that provider's SDK call — every call site already routes through it,
  so no call sites need to change. Never log API keys, tokens, full database
  rows, or precise personal identifiers — `context` should stay to small
  hints (a screen/action name).
- **`src/errors/retry.ts`** — bounded retry (`retryIdempotent`) for
  genuinely idempotent actions only (leave, abandon, finalize, join are all
  idempotent RPCs by design — see the exit-flow and resume docs). Never wraps
  a non-idempotent action, and never retries unboundedly.
- **`src/hooks/useOnlineStatus.ts`** — tracks `navigator.onLine` /
  `online`/`offline` events; surfaces the offline banner and gates the
  solo-run-resume check.

## Vercel

- **Build/deploy logs:** Vercel dashboard → project → **Deployments** → pick
  a deployment → **Build Logs** / **Function Logs** (this app is a static
  SPA, so "Function Logs" mostly won't apply — the interesting log is the
  build log for `npm run build` failures).
- **Environment variables:** **Project → Settings → Environment Variables**.
  Public (`VITE_*`) variables are safe to see in the client bundle; never put
  a secret in a `VITE_*` variable. See the root `README.md` and
  `docs/MULTIPLAYER_SETUP.md` / `docs/CAPTCHA_SETUP.md` for the exact list.
- **Rollback:** Vercel dashboard → **Deployments** → find the last known-good
  deployment → **⋯ → Promote to Production**. This is instant and doesn't
  require a new build.

## Supabase

- **Auth:** Dashboard → **Authentication → Users** to see anonymous sessions;
  **Authentication → Rate Limits** / **Attack Protection** for built-in auth
  throttling and the optional CAPTCHA toggle (see `docs/CAPTCHA_SETUP.md`).
- **Database:** Dashboard → **Database → Logs** for slow queries and errors;
  **Database → Roles** to confirm `anon`/`authenticated` grants match what
  the migrations expect (no direct table writes — only the RPCs).
- **Realtime:** Dashboard → **Realtime → Inspector** to watch live
  channel/presence traffic during a multiplayer match if something looks
  stuck.
- **Rate limiting:** application-level limits live in
  `public.rate_limits` (see `docs/ANTI_ABUSE.md`) — query it directly in the
  SQL editor if you suspect a user is being incorrectly throttled:
  `select * from rate_limits where user_id = '<uuid>' order by bucket_start desc;`
- **Rollback:** Supabase migrations are additive/incremental by design (see
  `supabase/migrations/README` conventions in each file's header) — rolling
  back application code (via Vercel) does not require rolling back the
  database, since new columns/functions are backward compatible with older
  client code. If a specific migration must be reverted, write a new
  incremental migration that undoes it (never edit an applied migration file
  in place).

## Google Maps / Street View

- **Quota & billing:** Google Cloud Console → **APIs & Services →
  Dashboard** → Maps JavaScript API, for request volume; **Billing →
  Budgets & alerts** to set a monthly budget alert (recommended: alert at
  50%/90%/100% of your expected monthly spend).
- **API restrictions:** Console → **APIs & Services → Credentials** → the
  browser key → confirm **HTTP referrer restrictions** list exactly your
  production domain, Vercel preview pattern, and `localhost` for dev — see
  the root `README.md`'s "Google Street View setup" section for the exact
  steps.
- **Diagnosing failures:**
  - *"This page can't load Google Maps correctly"* / blank panorama →
    almost always a referrer restriction mismatch (the deployed domain isn't
    in the allow-list) or the Maps JavaScript API not enabled on the
    project.
  - `RefererNotAllowedMapError` in the browser console → referrer
    restriction issue specifically; check the exact host (including
    protocol/port for local dev).
  - `ApiNotActivatedMapError` → the Maps JavaScript API isn't enabled for
    the project.
  - Billing-related errors (`BillingNotEnabledMapError`) → no billing
    account linked to the project.
  - A round silently skips to a "spare" location → normal, expected
    behavior when no Street View panorama exists near that coordinate (see
    `SEARCH_RADII` in `src/components/street/StreetView.tsx`), not an error.
- **Recommended review cadence:** check the Maps usage dashboard weekly
  during active development/playtesting; daily during a public launch week.

## Rollback procedure (summary)

1. **App-only regression** (bad UI/logic, no schema change involved):
   Vercel → promote the previous deployment. Done.
2. **Regression tied to a new migration:** promote the previous Vercel
   deployment (so the client stops calling the new/changed RPCs), then write
   a new incremental migration to fix or revert the problematic change —
   never edit the applied migration file, and never drop a column/table that
   might still hold data you need.
3. **CAPTCHA/rate-limit false positives:** rate limits are per-user and
   time-boxed (see `docs/ANTI_ABUSE.md`) — they self-recover; there's no
   manual "unblock" needed beyond waiting out the window, though you can
   `delete from rate_limits where user_id = '<uuid>'` in the SQL editor for
   an urgent individual case.

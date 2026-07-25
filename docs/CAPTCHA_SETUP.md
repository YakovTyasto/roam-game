# Optional production CAPTCHA (Cloudflare Turnstile)

Roam's only authentication entry point is anonymous sign-in
(`src/multiplayer/auth.ts#ensureAnonymousSession`) — there's no email/password
flow. Supabase's official, supported way to add CAPTCHA protection to that
sign-in is a project-level toggle in the Dashboard plus a `captchaToken` you
pass to `supabase.auth.signInAnonymously()`. That plumbing already exists in
this codebase (`ensureAnonymousSession(captchaToken?)`); this document covers
the remaining steps to turn it on.

**This is optional and off by default.** Nothing in this repo enables CAPTCHA
automatically, and no build/test/dev step requires it — see "Local
development and tests" below.

## What this does and does not protect

- **Protects:** the anonymous sign-in bootstrap — the moment a brand-new
  browser identity is created. This is the natural point to slow down
  scripted mass-account creation.
- **Does not protect:** any RPC called *after* a session already exists (room
  creation, guess submission, profile writes, etc.). Supabase's CAPTCHA
  integration is part of `auth`, not a general-purpose gate you can attach to
  arbitrary RPCs. Those endpoints are protected instead by the server-side
  rate limiter in `supabase/migrations/0010_rate_limiting.sql`
  (`roam_check_rate_limit`) — see that migration's header comment for exactly
  which RPCs are wired up today and which remain to be wired using the same
  two-line pattern. **This is the honest limitation the V3 spec asked to be
  documented rather than papered over**: CAPTCHA alone cannot cover
  post-session abuse; the database rate limits are the real backstop there.

## 1. Get a Cloudflare Turnstile site key + secret

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/) →
   **Turnstile**.
2. **Add a site.** Add every domain that will run this app:
   - `localhost` (development)
   - your Vercel preview domain pattern (e.g. `*.vercel.app`, or the specific
     preview URL if Cloudflare requires exact hosts)
   - your production domain
3. Choose a widget mode — **Managed** is the reasonable default (usually
   invisible to real users, only challenges suspicious traffic).
4. Save. You get two values:
   - **Site key** — public, goes in the client.
   - **Secret key** — private, goes only in the Supabase Dashboard, **never**
     in a `VITE_*` variable or anywhere in this repository.

## 2. Configure Supabase Auth

1. Supabase Dashboard → your project → **Authentication → Attack
   Protection** (the exact menu path may say "Bot and Abuse Protection" on
   newer dashboard versions).
2. Enable **CAPTCHA protection**, provider **Turnstile**, and paste the
   **secret key** from step 1. This is a server-side setting — it lives in
   Supabase's project config, not in this app's environment variables.
3. Save. From this point on, Supabase's `signInAnonymously` (and any other
   auth call) will reject requests that don't include a valid
   `captchaToken`.

## 3. Configure the client

Add the **public site key only** as a Vite env var:

```dotenv
VITE_TURNSTILE_SITE_KEY=your_site_key_here
```

- Local development (`.env.local`, git-ignored): typically **left unset**, so
  CAPTCHA stays off locally even if it's enabled in a shared Supabase
  project — see "Local development and tests" below for how to reconcile
  this.
- Vercel: **Project → Settings → Environment Variables** →
  `VITE_TURNSTILE_SITE_KEY`, scoped to whichever environments (Preview /
  Production) you want protected. Redeploy after adding it.

`src/config/env.ts` exposes `hasTurnstileConfig()` / `TURNSTILE_SITE_KEY` for
this. `ensureAnonymousSession(captchaToken?)` already forwards a token to
Supabase exactly as its SDK expects
(`signInAnonymously({ options: { captchaToken } })`) when one is supplied.

## 4. Render the widget and obtain a token

This repo does **not** bundle a Turnstile widget component — adding one
requires a live site key to test against, which isn't available in this
environment. To complete the integration:

1. Add the official Cloudflare Turnstile script (or a small wrapper
   component) to the screen that calls `ensureAnonymousSession` (currently
   `NameScreen` / the profile bootstrap flow), gated behind
   `hasTurnstileConfig()` so nothing renders when unconfigured.
2. On successful widget completion, call
   `ensureAnonymousSession(token)` instead of `ensureAnonymousSession()`.
3. On widget error/expiry, clear the token and let the widget re-issue one —
   never fabricate a token client-side.

## Distinguishing failure modes

When wiring the widget, keep these three cases distinct in the UI (don't
collapse them into one generic "something went wrong"):

| Situation | How to detect | Suggested message |
|---|---|---|
| **Missing local dev config** | `hasTurnstileConfig()` is `false` and you're in dev | None needed — CAPTCHA is intentionally off; sign-in proceeds without a token. |
| **Production misconfiguration** | `hasTurnstileConfig()` is `true` but the widget fails to load/render (bad site key, domain not allow-listed) | "Verification is temporarily unavailable — please try again shortly," and log the failure via the error-reporting adapter (see the error-handling foundation work) — never block the user forever on a client-side script failure. |
| **CAPTCHA verification failure** | `signInAnonymously` rejects with an auth error even though a token was supplied | "We couldn't verify you're human — please try again," and let the widget re-issue a fresh token (Turnstile tokens are single-use). |

## Local development and tests

- Never set `VITE_TURNSTILE_SITE_KEY` in CI or in a shared `.env` committed
  to the repo.
- If your team's shared Supabase project has CAPTCHA enabled at the project
  level, either: (a) use a **separate Supabase project for local dev** with
  CAPTCHA off (recommended — matches this repo's existing pattern of solo
  mode working with zero backend), or (b) use Cloudflare's documented
  Turnstile **testing site keys** (always-pass / always-fail /
  always-challenge test keys, publicly documented by Cloudflare) in
  `.env.local` so local sign-in still succeeds without a real widget
  interaction.
- Vitest never touches Supabase (the SDK is dynamically imported and the
  test suite doesn't configure `VITE_SUPABASE_*`), so CAPTCHA is a non-issue
  for `npm run test`.

## Rollout checklist

- [ ] Turnstile site created for `localhost`, preview, and production
      domains
- [ ] Secret key set in Supabase Dashboard → Auth → Attack Protection
- [ ] `VITE_TURNSTILE_SITE_KEY` set in Vercel for Preview/Production only
- [ ] Widget component added and gated behind `hasTurnstileConfig()`
- [ ] Verified sign-in still works with CAPTCHA **disabled** (default dev
      path)
- [ ] Verified sign-in works with CAPTCHA **enabled** on a Preview deploy
      before enabling it in Production
- [ ] Confirmed the three failure modes above render distinct, friendly
      messages

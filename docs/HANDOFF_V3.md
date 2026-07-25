# Foundation & Gameplay Polish V3 — handoff report

## 1. Architecture summary

Roam remains a client-heavy React 18 + TypeScript (strict) + Vite SPA with
an optional, code-split Supabase backend (Postgres + RLS + Realtime +
anonymous auth). This phase extended that architecture along its existing
seams rather than introducing new ones:

- **Theme** (`src/config/theme.ts`, `src/hooks/useTheme.ts`): local-first
  preference with a pre-paint `<head>` script, live system-change listener,
  and non-blocking profile sync via a new nullable `player_profiles` column.
- **Game configuration** (`src/config/gameConfig.ts`): a single typed
  `GameConfig` (difficulty, round count, timer, movement-rule placeholder)
  now drives the game state machine instead of hardcoded constants — the
  reducer (`src/game/reducer.ts`) reads `roundCount`/`timerSeconds` from
  state, so fixed games of any length and Endless share one state machine.
- **Endless** (`src/utils/endlessSelection.ts`, `endlessStats.ts`):
  generates one round at a time through the same difficulty selector every
  other mode uses, never a preallocated manifest.
- **Exit flow** (`src/components/ui/ExitConfirmDialog.tsx`,
  `src/hooks/useExitGuard.ts`): a shared confirmation dialog and a
  back/refresh guard, layered on top of already-idempotent server RPCs
  (`mp_leave_room`, the new `roam_abandon_solo_run`).
- **Resume** (`src/solo/resume.ts`, `src/solo/localRunSnapshot.ts`): wires
  the previously-unused `roam_get_active_solo_run` RPC into a real
  Resume/Abandon flow for server-tracked runs, and a versioned local
  snapshot for Endless/unconfigured play — mirroring, not duplicating, the
  server-tracked resume shape.
- **Anti-abuse** (`supabase/migrations/0010_rate_limiting.sql`): a generic,
  non-client-callable rate-limit counter wired into 4 representative RPCs,
  plus optional CAPTCHA plumbing on the anonymous-auth bootstrap.
- **Error handling** (`src/errors/`): a top-level `ErrorBoundary`, typed
  error normalization, and a provider-neutral reporting adapter.
- **PWA**: conservative (`prompt`) service-worker updates with a visible
  banner, replacing the previous silent `autoUpdate`.
- **i18n** (`src/i18n/`): a typed, compile-time-checked EN/RU translation
  system with real Russian pluralization, applied to Settings and the exit
  dialog as a proven pattern (see `docs/LOCALIZATION.md` for the honest
  scope boundary — most screens are not yet migrated).

## 2. Branch

`claude/foundation-gameplay-polish-v3-6oifol` — based on and up to date with
`origin/main` at `d4576bd` (the merged difficulty/party/leaderboard +
location-cooldown state). **Not merged. Not deployed.**

## 3. Commit hashes (chronological)

| Commit | Summary |
|---|---|
| `568a138` | Add Dark/Light/System theme system |
| `6edf625` | Audit real difficulty system; add dataset validation |
| `5f64d81` | Add custom game configuration and Fixed/Endless modes (solo) |
| `ebcec4c` | Add always-available exit flow (solo, Endless, multiplayer) |
| `b109ada` | Wire up solo run resume (server-tracked + local-only) |
| `8d5d637` | Add server-side rate limiting and CAPTCHA plumbing/docs |
| `e607a8b` | Add error handling and monitoring foundation |
| `2baf8ca` | Harden PWA update flow and add non-nagging install guidance |
| `c01e43a` | Add typed EN/RU localization system, wired into Settings + exit dialog |
| `b260d0a` | Fix Settings row layout clipping longer translations (accessibility) |
| `dee940a` | Document exact migration order and verify the 0005->latest upgrade path |

90 files changed, +6,127 / −165 lines versus `origin/main`.

## 4. Changed files by subsystem

- **Theme:** `src/config/theme.ts`, `src/hooks/useTheme.ts`, `index.html`
  (pre-paint script), `src/styles/variables.css` (light theme tokens),
  `src/components/settings/SettingsContent.tsx`, `src/profile/{useProfile,profileApi}.ts`
- **Difficulty audit:** `src/utils/datasetValidation.ts`,
  `src/utils/difficultyPool.test.ts` (strengthened)
- **Game config / Fixed & Endless:** `src/config/gameConfig.ts`,
  `src/game/{state,reducer}.ts`, `src/screens/SoloSetupScreen.tsx`,
  `src/screens/GameScreen.tsx`, `src/screens/FinalScreen.tsx`,
  `src/components/hud/HUD.tsx`, `src/utils/{endlessSelection,endlessStats}.ts`,
  `src/components/ui/EndlessUsageNotice.tsx`, `src/solo/{useSoloRun,soloRunApi}.ts`
- **Exit flow:** `src/components/ui/ExitConfirmDialog.tsx`,
  `src/hooks/useExitGuard.ts`, `src/screens/multiplayer/{MultiplayerGame,Lobby}.tsx`
- **Resume:** `src/solo/{resume,localRunSnapshot}.ts`,
  `src/screens/ResumePromptScreen.tsx`, `src/App.tsx`,
  `src/components/street/StreetView.tsx` (shared `PanoramaTarget` type)
- **Anti-abuse:** `src/utils/rateLimit.ts`, `src/config/env.ts`
  (Turnstile config), `src/multiplayer/auth.ts` (captchaToken plumbing)
- **Error handling:** `src/errors/{types,normalize,report,retry}.ts`,
  `src/components/ErrorBoundary.tsx`, `src/main.tsx`
- **PWA:** `vite.config.ts`, `src/pwa/{useServiceWorkerUpdate,pwaInstall}.ts`,
  `src/components/ui/UpdateAvailableBanner.tsx`
- **i18n:** `src/i18n/{locale,t}.ts`, `src/i18n/messages/{en,ru}.ts`,
  `src/hooks/useLocale.ts`
- **Database:** `supabase/migrations/0006`–`0010`,
  `supabase/tests/03`–`06_*.sql`, `supabase/tests/README.md`
- **Docs:** `docs/{ANTI_ABUSE,CAPTCHA_SETUP,OPERATIONS,PWA_CHECKLIST,LOCALIZATION,HANDOFF_V3}.md`

## 5. New migrations (exact order)

`0006_theme_locale_preferences.sql` → `0007_custom_round_config.sql` →
`0008_solo_run_abandon.sql` → `0009_solo_run_resume.sql` →
`0010_rate_limiting.sql`. Full descriptions and the required application
order table: `supabase/tests/README.md`.

## 6. Database upgrade & rollback considerations

- All five migrations are additive/backward-compatible: new nullable
  columns (`theme_preference`, `locale_preference`), widened check
  constraints (round count 10→20), and new or same-signature functions.
  `roam_create_solo_run` is the one exception — its signature gained a
  parameter, which Postgres cannot do via `CREATE OR REPLACE`, so it's
  dropped and recreated with a default value for the new parameter
  (existing 3-arg call sites keep working unchanged).
- **Verified upgrade paths** against a real local Postgres (not simulated):
  fresh `0001→latest`, and `0005→latest` with a seeded pre-V3 profile row to
  confirm existing production data survives untouched and new columns
  default to `NULL` rather than requiring a backfill. See
  `supabase/tests/README.md` → "Upgrade-path verification".
- **Rollback:** promote the previous Vercel deployment (stops the client
  calling new/changed RPCs); the additive migrations don't need to be
  reverted for that to work. If a specific migration must be undone, write
  a new incremental migration — never edit an applied one. Full procedure:
  `docs/OPERATIONS.md` → "Rollback procedure".

## 7. New environment variables

**Public (safe in the client bundle, `VITE_*`):**
- `VITE_TURNSTILE_SITE_KEY` — optional, Cloudflare Turnstile site key for
  CAPTCHA on anonymous sign-in. Unset by default (CAPTCHA off). See
  `docs/CAPTCHA_SETUP.md`.

**Secret (never in `VITE_*` or this repo):**
- Turnstile **secret key** — configured only in the Supabase Dashboard
  (Auth → Attack Protection), not read by this app's code at all.

No other new environment variables were introduced. All existing variables
(`VITE_GOOGLE_MAPS_API_KEY`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`) are unchanged.

## 8. Supabase Dashboard / CAPTCHA manual steps

Full walkthrough: `docs/CAPTCHA_SETUP.md`. Summary:
1. Create a Cloudflare Turnstile site (localhost + preview + production
   domains), get a site key + secret key.
2. Supabase Dashboard → Authentication → Attack Protection → enable
   CAPTCHA, provider Turnstile, paste the **secret** key.
3. Set `VITE_TURNSTILE_SITE_KEY` (the **public** key) in Vercel, scoped to
   Preview/Production only — never commit it, never set it for local dev
   unless using Cloudflare's published test keys.
4. A Turnstile widget component still needs to be added (not included in
   this pass — no live key was available to test against); the token
   plumbing (`ensureAnonymousSession(captchaToken)`) is ready for it.

No other manual Supabase Dashboard changes are required — all five new
migrations are self-contained SQL.

## 9. Vercel environment configuration

No changes required beyond the existing `VITE_GOOGLE_MAPS_API_KEY` /
`VITE_SUPABASE_*` variables already documented in the root `README.md`.
Optionally add `VITE_TURNSTILE_SITE_KEY` (see above) once CAPTCHA is ready
to enable.

## 10. Google Maps quota/budget/referrer checklist

See `docs/OPERATIONS.md` → "Google Maps / Street View" for the full
checklist (quota dashboard location, budget alert recommendation,
referrer-restriction steps, and the specific error codes to look for when
diagnosing a Street View failure). No changes were made to Google Maps
usage patterns this phase — the single-panorama-instance discipline
(CLAUDE.md's non-negotiable rule #1) was preserved throughout; Endless mode
reuses the existing StreetView component's `location`/`panorama` dual-mode
rendering rather than adding any new panorama-loading path.

## 11. PWA installation/testing checklist

See `docs/PWA_CHECKLIST.md` for the full manual iOS/Android/desktop install
checklist, the update-flow verification steps, and the offline-load
verification steps.

## 12. Multi-browser gameplay checklist

Not independently re-verified in this pass beyond the existing app's
established behavior — no changes were made to browser-compatibility-
sensitive code (Street View panorama handling, WorldMap/Leaflet
rendering). Manual verification performed this session: Chromium (via
Playwright), light and dark `prefers-color-scheme`, 375px/420px viewports,
English and Russian locales — see section 14.

## 13. Security summary

- **RLS on every new/touched table** (`rate_limits`, `player_profiles`
  columns): deny-all for clients by default; all writes go through
  `SECURITY DEFINER` RPCs.
- **`set search_path = public, pg_temp`** on every new function, matching
  existing convention.
- **No caller-supplied identity accepted anywhere** — every new/changed RPC
  uses `auth.uid()` exclusively (`roam_abandon_solo_run`,
  `roam_check_rate_limit`, `roam_set_preferences`, etc.).
- **`roam_check_rate_limit` is not client-callable** (no grant to
  `anon`/`authenticated`) — only invocable from inside another
  `SECURITY DEFINER` function, matching the existing internal-helper
  pattern (`mp_reassign_host`, `mp_maybe_complete_round`).
- **The hidden-answer guarantee for an un-guessed round is unchanged** —
  verified by a new SQL test (`05_resume_verify.sql`) that the resume
  payload still withholds `lat`/`lng`/`label`/`country` for a
  pending/active round; the client renders a resumed round by pano id
  alone, exactly like multiplayer already does.
- **Finalize-once / abandon-never-scores** guarantees hold: an abandoned
  run cannot be finalized (server rejects it), and finalize is idempotent
  (already existing behavior, re-verified).
- **Leaderboard eligibility is server-side and unchanged**: `eligible :=
  (total_rounds = 5)` in the existing 0005 finalize functions already
  covers the new custom-round-count and Endless (local-only, never
  server-tracked) cases correctly — no new eligibility logic was needed.
- **No secrets read or committed** — confirmed below (section 18).

## 14. Test/lint/typecheck/build results

```
npm run typecheck   → 0 errors
npm run lint         → 0 errors, 0 warnings
npm run test          → 38 test files, 306 tests, all passing
npm run build          → succeeds; PWA precache 23 entries / 761.57 KiB
```

SQL verification (against a real local Postgres, not simulated): 6 suites
(`01`–`06_*.sql`), all passing, run twice — once fresh (`0001→latest`) and
once against a seeded pre-V3 database (`0005→latest`, see section 6).

Manual in-browser verification this session (Playwright + Chromium,
`/opt/pw-browsers/chromium`, since no Google Maps key / Supabase config is
available in this sandbox — Street View/multiplayer gameplay itself could
not be exercised end-to-end):
- Welcome → Solo Setup → Custom config panel, light and dark theme, zero
  console errors.
- Settings modal: theme toggle, language toggle (English/Russian, every
  visible string translated), install hint, zero console errors.
- 375px and 420px viewports in Russian: zero horizontal overflow (measured,
  not eyeballed) after the row-wrap fix.
- App renders correctly under the new top-level `ErrorBoundary`.

## 15. Bundle/chunk comparison

Built from a clean `npm install` on both sides.

| Chunk | Before (`origin/main`) | After (this branch) | Δ gzip |
|---|---|---|---|
| `index.js` (main) | 367.94 kB / 114.95 kB gzip | 403.56 kB / 125.68 kB gzip | +10.73 kB |
| `index.css` | 51.69 kB / 14.18 kB gzip | 56.12 kB / 14.83 kB gzip | +0.65 kB |
| `auth.js` (Supabase, code-split) | 216.52 kB / 56.22 kB gzip | 216.53 kB / 56.22 kB gzip | ~0 |
| `MultiplayerApp.js` (code-split) | 36.44 kB / 11.51 kB gzip | 36.37 kB / 11.56 kB gzip | ~0 |
| `workbox-window` (new, SW registration) | — | 5.75 kB / 2.36 kB gzip | +2.36 kB |
| PWA precache total | 714.76 KiB | 761.57 KiB | +46.8 KiB |

**Assessment:** no meaningful regression. The Supabase (`auth.js`) and
multiplayer chunks — the ones the solo bundle-lean guarantee cares most
about — are essentially unchanged, confirming the code-splitting discipline
held throughout (theme/i18n/error-handling/PWA/rate-limit-client code all
landed in the main chunk, which is expected since none of it is
Supabase-dependent or deferred). The ~10.7 kB gzip growth in the main chunk
covers the theme engine, difficulty validation, game config + Endless
logic, exit flow, resume, i18n (two full dictionaries + engine), error
handling, and PWA update/install logic combined — proportionate to the
amount of new functionality.

## 16. Known limitations

Documented in detail in their respective docs; summarized here:

- **Multiplayer custom round count/timer UI, live Realtime settings sync,
  and Endless multiplayer** are not implemented. The server already
  supports custom `total_rounds`/`round_duration` at room creation
  (pre-existing `mp_create_room` params, widened to 1-20 rounds this
  phase) — only the host-facing UI, live settings-change sync after a
  second player joins, and the Endless-specific round-by-round multiplayer
  flow are unbuilt. (`docs/HANDOFF_V3.md` section 1 / commit `5f64d81`.)
- **Rate limiting is wired into 4 of the ~10 sensitive RPCs** the spec
  lists (profile writes, room creation, solo run creation, solo run
  abandonment). The remaining ones (join, start, guess submission, round
  advance/expiry, finalize) follow the exact same two-line pattern,
  enumerated with reasoning in `docs/ANTI_ABUSE.md`.
- **CAPTCHA has no widget component yet** — the token plumbing
  (`ensureAnonymousSession(captchaToken)`) is real and functional per the
  Supabase SDK's documented API, but nothing calls it with a real token
  yet, since no live Turnstile site key was available to test against in
  this environment. `docs/CAPTCHA_SETUP.md` has the exact remaining steps.
- **i18n covers Settings and the exit dialog only.** Every other screen
  (Welcome, Solo Setup, GameScreen/HUD, Final, Leaderboard, Error, Name,
  Resume prompt, and the entire multiplayer UI) still renders English
  directly. `docs/LOCALIZATION.md` has a concrete suggested migration
  order.
- **Solo "Save and exit" for local-only games** (Endless, or fixed games
  with no Supabase configured) now genuinely resumes via the local
  snapshot — this was flagged as a gap in the exit-flow commit and closed
  in the very next (resume) commit, so there is no longer an open gap
  here.
- **No telemetry/error-reporting RPC exists** to rate-limit — the
  provider-neutral `reportError()` adapter is console-only in dev and
  silent in production until a provider (e.g. Sentry) is connected; there
  is no server endpoint receiving client error reports today.
- **Multi-browser/device gameplay was not independently re-verified**
  beyond what the existing app already guaranteed (see section 12) — no
  changes were made to browser-compatibility-sensitive rendering code.
- **This sandbox has no Google Maps key or Supabase project configured**,
  so actual Street View rendering, multiplayer gameplay, and the
  server-tracked resume/rate-limit flows could only be verified via SQL
  (against a real local Postgres) and unit tests, not a live end-to-end
  browser session against a real backend.

## 17. Deployment order

Per the task's required order — none of these steps were performed
automatically; this is guidance for the human operator:

1. Review this branch's code and the 5 new migrations.
2. Apply migrations `0006`→`0010` in the Supabase SQL Editor, in that exact
   order, to the target project.
3. Verify policies/grants/functions and re-run the SQL verification suites
   (`supabase/tests/01`–`06_*.sql`) against that project if practical, or at
   minimum spot-check the new RPCs via the SQL Editor.
4. Configure `VITE_TURNSTILE_SITE_KEY` (optional) and confirm no other env
   vars changed.
5. Deploy this branch to a Vercel **Preview** environment (not Production).
6. Manually test solo, Endless, multiplayer, resume, exit, themes,
   localization, PWA install/update, and rate limits on the Preview
   deployment using the checklists in `docs/PWA_CHECKLIST.md` and this
   report's section 12/14.
7. Merge only after manual approval.
8. Verify production after merge/deploy.
9. Monitor errors and Google/Supabase usage per `docs/OPERATIONS.md`.

**This session did not merge the branch, deploy to Vercel, or apply any
migration to a production Supabase project.**

## 18. Confirmation: no secrets were read or committed

- No `.env.local` or any credentials/API-key file was read, printed,
  staged, or committed during this session.
- `git log -p` and `git diff` were used throughout to review changes
  before every commit; no secret-shaped content (API keys, tokens,
  connection strings) appears in any commit on this branch.
- The only new environment variable introduced
  (`VITE_TURNSTILE_SITE_KEY`) is a **public** site key by design — the
  matching secret key was never generated, requested, or referenced
  anywhere in this repository; it lives exclusively in the Supabase
  Dashboard per `docs/CAPTCHA_SETUP.md`.
- All SQL verification in this session ran against a throwaway local
  Postgres instance created and destroyed within this session
  (`roam_mp_test`, `roam_upgrade_test`) — never against any real Supabase
  project.

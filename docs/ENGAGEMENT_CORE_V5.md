# Engagement Core V5 — implementation plan

Roam already ships solo, private/party multiplayer, difficulty tiers, Endless,
profiles, a weekly leaderboard, themes, EN/RU, server-side solo scoring and
Diversity Engine V2. V5 adds the *engagement loop*: a shared Daily Challenge,
shareable challenges, a Country Streak mode, real statistics and achievements —
and moves official online play onto a **server-authoritative catalog** so those
scores mean something.

This document is the working plan and the record of what was verified. It is
written to be read by the next person to pick the work up.

---

## Priority 0 — mobile interaction regression gate

**Status: the regression is fixed on `main`. Evidence below. Widened gate added.**

The reported production bug (desktop fine; iPhone/iPad Safari Play / mode
buttons and private multiplayer entry untappable, including in a private tab)
was fixed in `b0620da` — `src/screens/WelcomeScreen.module.css` scrolls
(`overflow-y: auto`) instead of clipping, so an action below the fold on a short
phone viewport can be brought into reach. `e2e/modeButton.spec.ts` was added
with it.

Verification performed on the current `main` (`bb7c439`) before any V5 code:

| Check | Result |
| --- | --- |
| `e2e/modeButton.spec.ts`, iPhone 390×664 touch | pass |
| `e2e/modeButton.spec.ts`, iPad 810×1080 touch | pass |
| `e2e/modeButton.spec.ts`, desktop 1280×720 mouse/keyboard | pass |
| `document.elementFromPoint()` at each control's own centre | pass — the control is the topmost element |
| Full-bleed layer audit (`findBlockingOverlays`) | no offender on the home screen |
| `pointer-events` / `touch-action` / `visibility` on every ancestor | none blocking |
| 44×44 px touch targets on home actions + settings | pass |
| Cold start with a hung backend | reaches an interactive screen within the 8 s bound; no residual overlay |
| Fixed bottom banner raised (offline) | home actions still hit-testable |
| Second load served by the service worker | home actions still hit-testable |
| Private multiplayer entry → create / join / back home | all reachable and tappable |
| In-game exit button + confirmation | reachable and tappable |
| Settings open/close, then home still usable | pass |

**WebKit could not be executed in this environment**: the Playwright browser CDN
is blocked by the sandbox network policy (`403 host not permitted` for
`playwright.download.prss.microsoft.com`), so `npx playwright install webkit`
fails. The Chromium projects at the same iPhone/iPad viewports with
`hasTouch: true` were run instead — the fallback the suite was already designed
for (see `e2e/README.md`). **CI and the real-device checklist must still run the
WebKit projects**; nothing in this pass is evidence about Safari specifically.

No production code change was needed for P0. What *was* added is a wider gate so
the next regression is caught whichever way it arrives — see
`e2e/mobileInteraction.spec.ts` and the stub harness in `e2e/support/`.

### The stub harness, and why it exists

The e2e build is now configured like a real deployment (Maps key + Supabase URL
baked in) with both backends intercepted in-process:

- `e2e/support/supabase.ts` — same-origin (`/__supabase`) Supabase stand-in, so
  no CORS preflight can make a test fail for reasons unrelated to the app. Tests
  can inspect which RPCs the UI called, reprogram one, or make the backend hang.
- `e2e/support/googleMaps.ts` — a minimal Google Maps JS API stand-in. **No
  billable panorama load ever happens**, and because the app code is untouched,
  the single-`StreetViewPanorama` cost rule is now asserted from a real browser.
- `e2e/support/touch.ts` — the shared "did a finger reach this?" helpers.

This is what makes the rest of V5 testable in a browser at all: Daily resume,
Country Streak selection, exit confirmation and share fallback all need the app
to get past the panorama.

---

## Status

Implemented, verified and pushed in this pass:

| # | Section | Status |
| --- | --- | --- |
| 0 | Mobile interaction regression gate | **Done** — verified fixed, gate widened |
| 1 | Server-authoritative location catalog | **Done** — migrations 0013-0015 |
| 2 | Daily Challenge | **Done** — migration 0016 |
| 3 | Shareable challenge links | **Done** — migration 0017 |
| 4 | Country Streak | **Not started** |
| 5 | Player statistics | **Not started** |
| 6 | Achievements | **Not started** |
| 7 | Home and navigation integration | **Partial** — Daily and Challenge entry points added and covered by the mobile gate; the full restructure is not done |
| 8 | Shareable result card | **Partial** — the share transport (`src/share/share.ts`: Web Share + clipboard + legacy fallback) is done, tested and in use by challenge links; the rendered card itself is not built |

See "Continuation point" at the end of this document for exactly where to resume.

## Sections 1–8 — order and shape

The sections are implemented in the stated priority order, one commit per
coherent unit, tests with each unit.

### Migration numbering and rollout

Latest deployed migration is `0012_room_diversity.sql`. V5 adds migrations from
**`0013`** upward, strictly additive, in this order:

| # | Migration | Contents |
| --- | --- | --- |
| 0013 | `catalog_schema` | `game_catalog` + verification metadata, RLS deny-all, helper functions |
| 0014 | `catalog_seed` | deterministic, idempotent seed of the verified catalog |
| 0015 | `official_runs` | versioned official-run RPCs (`*_v2`) reading rounds from the catalog |
| 0016 | `daily_challenge` | daily selection, attempts, guesses, finalization, leaderboard |
| 0017 | `shared_challenges` | unlisted challenge codes, attempts, results |
| 0018 | `country_streak` | streak runs, rounds, best-streak records (**not written — see Continuation point**) |
| 0019 | `stats` | aggregate statistics RPCs (**not written**) |
| 0020 | `achievements` | achievement definitions, unlocks, server-side evaluation (**not written**) |

Rules that hold for every one of them:

- **Never modify an already-deployed migration.** `0001`–`0012` are frozen.
- Additive only: new tables, new functions, new grants. No legacy RPC is dropped
  in this rollout, so the **currently deployed frontend keeps working** after the
  migrations are applied and before the new frontend ships. New behaviour goes in
  `*_v2` functions; the cleanup path for the old ones is documented at the end of
  this file, to be executed in a *later* release.
- Every new table: RLS enabled, explicit policies, direct client privileges
  revoked, mutations only through validated `SECURITY DEFINER` RPCs with
  `set search_path = public, pg_temp`, identity from `auth.uid()`, bounded
  inputs, idempotency, and `for update` locking where concurrency matters.
- Every migration group gets a `supabase/tests/NN_*_verify.sql` file, runnable
  against both a clean install and an upgrade from the current production schema.

### Section 1 — server-authoritative catalog

The client currently hands the server a full manifest *including target
coordinates* (`roam_create_solo_run(p_manifest)`), so a determined player can
read tomorrow's answers out of the bundle. V5 moves the answer set server-side:

- `game_catalog` holds one row per curated location (stable id, canonical group,
  pano id, target lat/lng, label, country, continent, difficulty, setting,
  heading/pitch/zoom, active flag, Street View verification metadata, timestamps).
  Existing stable ids are preserved exactly; nothing is invented.
- No `select` for `anon`/`authenticated`. RLS on. Writes are service-role only —
  seeding happens through migrations, never through a browser key.
- Official runs are created by `roam_start_official_run_v2(mode, difficulty,
  rounds)`, which selects from the catalog server-side and returns only what the
  browser needs to render the *current* round: run id, round number, pano id,
  orientation, server start/deadline. **No target coordinates before the round is
  completed.**
- `roam_submit_official_guess_v2` identifies the player by `auth.uid()`,
  validates membership, locks the round, is idempotent, scores with the existing
  `mp_haversine_km`/`mp_score` helpers (no competing implementation), rejects
  invalid coordinates and early/late/duplicate submissions, reveals the answer
  only for the round just completed, and updates totals exactly once.
- Multiplayer selects its manifest on the server; a host client can no longer
  supply trusted coordinates. Room difficulty, round count, player limit, shared
  locations, timers, room-wide novelty, reconnect, rematch, results and existing
  room links/codes are all preserved.
- Offline Classic Solo keeps using the bundled catalog, clearly marked
  local/non-official: playable, never submitted to an official leaderboard, never
  fabricating a server result, and never behind an unbounded spinner.

**Unavoidable limitation, stated plainly:** the active panorama id must reach the
rendering client, so a sophisticated player can resolve that panorama through
Google's own services and derive the answer. Server authority removes the *bulk*
leak (the whole answer set in the bundle) and makes scoring untrusted-client-proof;
it cannot hide the panorama currently on screen.

### Section 2 — Daily Challenge

One challenge per UTC calendar day, same locations and order for everyone, 5
rounds by default. One official scored attempt per anonymous authenticated user
per UTC day; partial attempts resume; a completed attempt cannot be replayed for
a second official score (practice after completion never overwrites it). Server
time defines the day and the deadlines. Selection is server-side, deterministic,
transactional, and uses Diversity Engine concepts so consecutive days avoid
repeating canonical groups — with **no publicly predictable seed**, and future
days never exposed.

Tie-breaking, applied everywhere a rank is produced and documented in the UI:

1. higher total score
2. lower total distance
3. shorter completion duration
4. earlier completion timestamp

The leaderboard RPC returns rank, display name, total score, total distance,
duration, completion time and the caller's own position — never a UUID.

### Section 3 — Shareable challenge links

Unlisted challenges reachable by code, integrated with the app's existing
navigation (the app is currently a single route driven by `?room=` for invites;
challenges get a real path with a `?c=` compatibility fallback and Vercel SPA
rewrites so a direct browser navigation works). Creator picks difficulty, 5 or 10
rounds, optional timer, a sanitized length-limited title and an optional
expiration with a safe default. **The server chooses and stores the locations** —
the creator cannot supply coordinates or pano ids. One official attempt per user,
resumable, server-scored, finalized once. Invalid/expired/missing codes get real
error states and a route home. Creation and joining are rate-limited through the
existing `roam_check_rate_limit` infrastructure.

### Section 4 — Country Streak

Endless country-identification mode: one wrong answer ends the official streak.
Server-authoritative current/best streak, idempotent round submission, no
duplicate canonical group until the pool is exhausted, no immediate country
repeats where the pool allows. Uses the existing difficulty pools and timers. A
searchable, keyboard-accessible, large-touch-target country selector that works
with translated labels and cannot submit an empty selection. Local practice mode
when the server is unavailable, labelled non-official.

### Section 5 — Player statistics

Aggregated through protected RPCs and database aggregation, never derived from
mutable localStorage for authoritative numbers. Overall / by mode / by difficulty
/ multiplayer / activity. Loads progressively, never blocks home, bounded timeout
with retry, falls back to a clearly-labelled local summary, and works for an
empty profile.

### Section 6 — Achievements

A centralized typed registry shared by evaluation and UI, evaluated **server-side
from completed official results**. No client-authoritative unlock RPC that
accepts arbitrary achievement ids. Unlocks are once-only and idempotent under
retries and repeated finalization, stamped with server time. Toast that never
covers controls, a gallery with locked/unlocked state, localized descriptions,
accessible labels, and no meaning carried by colour alone.

### Section 7 — Home and navigation

Clear entry points for Classic Solo, Multiplayer, Daily, Country Streak,
Create/Join Challenge, Leaderboard, Statistics/Achievements and Settings —
without turning the home screen into a dashboard, and preserving the current
visual identity. Mobile-first, ≥44×44 px targets, safe-area aware, no overlapping
fixed layers, keyboard and screen-reader support, Light/Dark/System, EN/RU, no
layout shift that makes a user tap the wrong card, and one failing backend
feature never disables the others.

### Section 8 — Shareable result card

A compact, spoiler-free card (SVG/Canvas — no new dependency) for Daily,
Challenge, Country Streak and normal games. Contains branding, mode, score or
streak, difficulty, rounds, date, the non-secret challenge code where relevant,
an emoji summary and the site domain. Never coordinates, pano ids, UUIDs, API
keys or hidden answers. Web Share API where available, downloadable image, and a
clipboard text fallback; works on iOS Safari in both themes.

---

## Deferred cleanup (a later release, not this one)

Once the new frontend is fully deployed and no old client remains:

1. Drop `roam_create_solo_run(text, int, jsonb, int)` and the client-manifest
   path in `mp_start_match`, leaving only the `*_v2` catalog-driven functions.
2. Remove `lat`/`lng`/`label`/`country` from client-supplied manifest validation
   in `src/multiplayer/manifest.ts` (kept during rollout for the old client).
3. Consider narrowing `solo_run_rounds` answer columns to catalog references.

Do not do any of this in the same rollout as the migrations above: an old
deployed frontend must keep working after the database is migrated.


---

## What shipped, concretely

### Migrations (apply in this order)

| # | File | Adds |
| --- | --- | --- |
| 0013 | `catalog_schema` | `game_catalog` (RLS deny-all, no client privileges), `roam_catalog_summary` (counts only, granted), `roam_catalog_pool`, `roam_select_catalog_rounds` (both server-only) |
| 0014 | `catalog_seed` | 325 verified locations. **Generated** — see below |
| 0015 | `official_runs` | `solo_runs.mode`/`.server_selected`, `solo_run_rounds.group_id`/`.expires_at`; `roam_write_run_rounds`, `roam_recent_groups_for`, `roam_charge_group_played`, `roam_run_payload` (all server-only); `roam_start_official_run_v2`, `roam_get_official_run_v2`, `roam_submit_official_guess_v2`, `roam_finalize_official_run_v2`, `mp_start_match_v2` (granted) |
| 0016 | `daily_challenge` | `daily_challenges`, `daily_challenge_rounds`, `daily_attempts`; `roam_utc_day`, `roam_start_daily_v2`, `roam_daily_status`, `roam_daily_leaderboard` (granted); `roam_ensure_daily_challenge`, `roam_on_run_finalized` (server-only) |
| 0017 | `shared_challenges` | `shared_challenges`, `shared_challenge_rounds`, `shared_challenge_attempts`; `roam_create_challenge_v2`, `roam_get_challenge_v2`, `roam_start_challenge_v2`, `roam_challenge_leaderboard` (granted); `roam_gen_challenge_code`, `roam_clean_challenge_title`, `roam_on_run_finalized` (server-only) |

Regenerate / drift-check `0014`:

```bash
npx vite-node scripts/generate-catalog-seed.ts             # regenerate
npx vite-node scripts/generate-catalog-seed.ts -- --check   # CI gate
```

### Security posture for every new table

`game_catalog`, `daily_challenges`, `daily_challenge_rounds`, `daily_attempts`,
`shared_challenges`, `shared_challenge_rounds`, `shared_challenge_attempts`:

- RLS **enabled**; `anon` and `authenticated` have **no** table privileges at all
  (`revoke all`), so no browser key can read a target coordinate or write a score.
- The only permissive policies are owner-scoped `select` policies on the two
  attempt tables, as defence in depth if a future migration ever grants `select`.
- Every mutation goes through a `SECURITY DEFINER` RPC with
  `set search_path = public, pg_temp`, identity from `auth.uid()`, bounded inputs,
  `for update` locking where concurrency matters, and idempotent writes.
- Functions that take a caller-supplied identity or a reveal flag
  (`roam_recent_groups_for`, `roam_charge_group_played`, `roam_run_payload`,
  `roam_on_run_finalized`, `roam_ensure_daily_challenge`,
  `roam_select_catalog_rounds`, `roam_catalog_pool`) are **ungranted** — callable
  only from inside another trusted function. `09`/`10`/`11_*_verify.sql` assert this.
- Rate limits reuse `roam_check_rate_limit` (migration 0010): official run start,
  guess submission, daily start, daily leaderboard, challenge create, challenge
  lookup, challenge start, challenge leaderboard.

### Never trusted from the client

Score, distance, elapsed time, target, country answer, and the location manifest.
The client sends coordinates and a round number; the browser tests assert exactly
that (`e2e/officialRun.spec.ts` checks the submitted parameter names).

---

## Environment variables

**No new variables.** The full set is unchanged:

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | for Street View | Public browser key; restrict by HTTP referrer |
| `VITE_SUPABASE_URL` | for all online play | Public |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | for all online play | Public (anon) key. RLS is the protection |
| `VITE_TURNSTILE_SITE_KEY` | optional | Public CAPTCHA site key (docs/CAPTCHA_SETUP.md) |

No service-role or catalog-import credential exists in any Vite variable, and the
catalog is seeded by migration (service role / owner), never from a browser.

---

## Deployment procedure

### 1. Back up and check current Supabase state

```sql
-- Confirm the deployed migration level before touching anything.
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname = 'roam_room_recent_groups';   -- expect 1 row (0012 applied)
select to_regclass('public.game_catalog');                             -- expect NULL (0013 not applied)
```

Take a Supabase dashboard backup (Database → Backups) or `pg_dump` before applying.

### 2. Apply migrations, in this exact order

`0013_catalog_schema.sql` → `0014_catalog_seed.sql` → `0015_official_runs.sql` →
`0016_daily_challenge.sql` → `0017_shared_challenges.sql`

Via the SQL Editor (paste each file in full, in order) or `supabase db push`.
Each is additive; none drops or revokes a pre-V5 function.

### 3. Run the verification queries

```sql
-- Catalog seeded and deduplicated.
select count(*) as locations,
       count(distinct pano_id) as panos,
       count(distinct group_id) as groups
  from public.game_catalog;                       -- expect 325 / 325 / 325

-- Counts-only summary is readable; the catalog itself is not.
select public.roam_catalog_summary();             -- expect 325 total, 79 countries
select has_table_privilege('authenticated', 'public.game_catalog', 'select');   -- expect false
select has_table_privilege('authenticated', 'public.daily_challenge_rounds', 'select'); -- expect false
select has_table_privilege('authenticated', 'public.shared_challenge_rounds', 'select'); -- expect false

-- New RPCs exist and are granted only where intended.
select has_function_privilege('authenticated', 'public.roam_start_official_run_v2(text, int, int)', 'execute'),  -- true
       has_function_privilege('authenticated', 'public.roam_select_catalog_rounds(text, int, text[], text[])', 'execute'), -- false
       has_function_privilege('authenticated', 'public.roam_on_run_finalized(uuid, uuid, text, int, double precision)', 'execute'); -- false

-- Legacy RPCs still available for the currently deployed frontend.
select has_function_privilege('authenticated', 'public.roam_create_solo_run(text, int, jsonb, int)', 'execute'), -- true
       has_function_privilege('authenticated', 'public.mp_start_match(uuid, jsonb)', 'execute');                 -- true

-- No future Daily exists.
select count(*) from public.daily_challenges where utc_day > (now() at time zone 'UTC')::date; -- expect 0
```

For a full local rehearsal before touching production:

```bash
supabase/tests/run-local.sh                       # clean install 0001→0017
supabase/tests/run-local.sh --upgrade-from 0012   # the actual production upgrade path
```

### 4. Deploy a Vercel Preview

```bash
git push -u origin claude/roam-engagement-core-v5-zj8ok8   # already pushed
```

Vercel builds a Preview for the branch automatically. Confirm in the Preview's
build settings that the three `VITE_*` variables are present for the Preview
environment. `vercel.json` (new) supplies the SPA rewrite that `/challenge/<CODE>`
needs — **verify it took effect** by opening a challenge link directly in the
Preview, not by client-side navigation. If the rewrite is ever missing, the
`?c=<CODE>` link form still works with no server configuration.

### 5. Smoke test the Preview (desktop + mobile)

See the real-device checklist below.

### 6. Merge

Only after the Preview smoke test passes. No PR has been opened by this work.

### 7. Production verification

Re-run the section 3 queries against production, then in the app: start a solo
game (confirm it is *not* labelled unranked), take the Daily, create a challenge
and open its link in a second browser profile, and check the Daily leaderboard
shows both players' names and no ids.

### 8. Optional later cleanup

The deferred cleanup listed at the end of this document. **Not** in this rollout.

---

## Real-device checklist

WebKit could not be executed in the development sandbox (the Playwright browser
CDN is blocked by network policy), so **the WebKit projects and these device
checks are the only Safari evidence** — nothing in this pass proves Safari
behaviour. Run `npm run test:e2e` in CI, where WebKit installs normally.

### iPhone (Safari, and again as an installed PWA)

- [ ] Tap Solo game, a difficulty card, a round chip, Start game — each responds
      to the first tap
- [ ] Tap the Daily card; take the challenge; background the app mid-round and
      return; confirm the round and timer resume from server state
- [ ] Tap Private multiplayer → Create private room → back to home
- [ ] Open a `/challenge/<CODE>` link from Messages; confirm it opens the
      challenge and not the home screen
- [ ] Tap Share link on a challenge; confirm the native sheet opens; dismiss it
      and confirm nothing was silently copied
- [ ] Go offline mid-game; confirm the offline banner appears and does **not**
      block any button; confirm Classic Solo still starts and its result is
      labelled as not ranked
- [ ] In-game exit button → Abandon → home screen fully interactive
- [ ] Rotate to landscape and back; no control ends up under the notch or the
      home indicator
- [ ] With a fresh install: complete onboarding, then force-quit and reopen

### iPad (Safari)

- [ ] The same list, plus split-screen at the narrowest width

### Desktop

- [ ] Mouse, keyboard (Tab/Enter/Space) and focus-visible outlines on every new
      screen
- [ ] Light / Dark / System theme on the Daily and Challenge screens
- [ ] EN and RU on both, including the long Russian strings in the Daily card

---

## Compatibility and rollback

**Forward compatibility (old frontend, new database).** Guaranteed and asserted:
`09_catalog_verify.sql` part 5 starts a legacy manifest run, submits a guess
through the legacy RPC, reads the legacy active-run RPC, and asserts both legacy
grants are intact.

**Rollback of the frontend alone** (revert the Vercel deployment): safe. The old
client calls the old RPCs, which are untouched. Daily/challenge rows created by
the new client become inert but valid data.

**Rollback of the database** is not required by a frontend rollback, and is not
recommended: `0013`-`0017` only add. If a specific feature must be disabled
without a deploy, revoke its entry point — e.g.
`revoke execute on function public.roam_start_daily_v2(boolean) from authenticated;`
— and the client's bounded failure path turns the Daily card into its
"unavailable" state while everything else keeps working.

**Per-feature kill switches** (all reversible with one statement):

| Feature | Statement |
| --- | --- |
| Daily Challenge | `revoke execute on function public.roam_start_daily_v2(boolean) from authenticated;` |
| Challenge creation | `revoke execute on function public.roam_create_challenge_v2(text, int, int, text, int) from authenticated;` |
| Official solo runs | `revoke execute on function public.roam_start_official_run_v2(text, int, int) from authenticated;` (clients fall back to local, clearly-labelled unranked play) |
| Server-selected multiplayer | `revoke execute on function public.mp_start_match_v2(uuid) from authenticated;` (revert the client to `startMatch`, which is retained for exactly this) |

---

## Known limitations

1. **The active panorama id reaches the browser.** It must, to be rendered. A
   determined player can resolve it through Google's own Street View services and
   recover the location. V5 removes the bulk leak (the whole answer set in the JS
   bundle) and makes scoring untrusted-client-proof; it cannot hide the panorama
   currently on screen. This is a property of Street View, not of the schema.
2. **WebKit was not executed in this pass.** See the checklist above.
3. **The SPA rewrite is configuration, not code.** `vercel.json` is in the repo,
   but only a real Preview deployment proves it applies. The `?c=` link form is
   the fallback if it does not.
4. **Endless remains local-only and unranked**, as before. It has no fixed length,
   so there is nothing to rank.
5. **Daily difficulty is fixed at Normal.** The schema stores a per-day difficulty
   and the RPCs read it, so varying it later needs no migration — but today every
   day is generated as Normal/5 rounds.
6. **Realtime is not used by Daily or challenges.** Leaderboards are fetched on
   open and after finishing, not pushed.
7. **`src/multiplayer/manifest.ts`, `resolvePanorama.ts` and `roomDiversity.ts`
   are no longer on the live path.** They are retained deliberately as the
   documented client-side rollback for `mp_start_match_v2` and are still covered
   by their unit tests. They are removed in the cleanup release.
8. **A challenge's expiry does not delete its rows.** Expired challenges are
   refused at the RPC and remain as history; a retention job is a later concern.

---

## Continuation point

Everything below is unstarted or partial. Resume in this order.

### Section 4 — Country Streak (next)

Create **`supabase/migrations/0018_country_streak.sql`**:

- `streak_runs (id, user_id, difficulty, status, current_streak, best_streak,
  total_attempts, started_at, ended_at)` and
  `streak_rounds (run_id, round_number, location_id, group_id, pano_id,
  heading/pitch/zoom, country, continent, answered_country, correct, created_at)`,
  plus `streak_bests (user_id, difficulty, best_streak, achieved_at)` for the
  leaderboard. RLS deny-all, owner-scoped `select` policy as defence in depth.
- `roam_start_streak_v2(p_difficulty)` — one active run per player; reuse
  `roam_select_catalog_rounds` for one round at a time, excluding groups already
  used in this run and avoiding an immediate country repeat while the pool allows.
- `roam_submit_streak_country_v2(p_run_id, p_round_number, p_country)` — compare
  against `game_catalog.country` **server-side**, idempotent per round
  (`unique (run_id, round_number)` on the answer), advance or end the streak, and
  update `best_streak` transactionally.
- `roam_get_streak_v2(p_run_id default null)` — resume; the target country must be
  absent until the round is answered (same reveal gate as `roam_run_payload`).
- Extend `roam_on_run_finalized`? **No** — Country Streak does not use `solo_runs`;
  it ends on a wrong answer rather than a fixed round count. Keep it separate.
- Add `supabase/tests/12_streak_verify.sql`.

Client: `src/streak/` (pure transition logic + tests), a searchable country
selector component (the country list already exists in `src/config/geography.ts`
— derive it from `COUNTRY_CONTINENT` so it cannot drift from the catalog), and a
setup/game/result flow. The selector must have ≥44px rows, be keyboard operable,
never submit an empty selection, and show flags as decoration only.

### Section 5 — Player statistics

`0019_stats.sql`: aggregate RPCs over `game_results`, `daily_attempts`,
`shared_challenge_attempts`, `streak_runs` and `location_history` — not raw event
dumps. `roam_player_stats()` returning overall / by-mode / by-difficulty /
multiplayer / activity blocks, plus `roam_daily_streak()` for participation
streaks. Client: a progressively-loading screen with a bounded timeout, retry, and
a clearly-labelled local fallback.

### Section 6 — Achievements

`0020_achievements.sql`: `achievements` definition table (or a typed registry
mirrored in SQL), `player_achievements (user_id, achievement_id, unlocked_at,
progress)` with `unique (user_id, achievement_id)`; evaluation inside
`roam_on_run_finalized` and the streak finalizer — **no** client-callable unlock
RPC. Share the typed registry with the UI from `src/achievements/registry.ts`.
Tests must prove a direct client write is impossible and that repeated
finalization cannot duplicate an unlock.

### Section 7 — Home restructure

The Daily card and the Challenge entry are in place and covered by the mobile
gate. What remains: a coherent grid for all eight entry points, Statistics and
Achievements entries (blocked on 5 and 6), and localizing the remaining
hard-coded English on `WelcomeScreen` (it predates the i18n system). Keep the
current visual identity, and re-run `e2e/mobileInteraction.spec.ts` after every
layout change — it already caught two real regressions from adding one button.

### Section 8 — Result card

`src/share/share.ts` is done. What remains is the card itself: an SVG built from
the result, rasterised with `OffscreenCanvas`/`<canvas>` (no new dependency), a
spoiler-free emoji grid, and a `File` passed to `share({ files })` — the existing
`canShare` guard already handles platforms that refuse image shares. It must
never include coordinates, pano ids, user ids or hidden answers; add a
sanitization test asserting exactly that against a full result object.

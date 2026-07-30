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
| 0018 | `country_streak` | streak runs, rounds, best-streak records |
| 0019 | `stats_and_achievements` | aggregate stats RPCs, achievement registry + unlock evaluation |

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

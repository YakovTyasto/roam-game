# CLAUDE.md

Guidance for working in this repository.

## What this is

**Roam** — a geography guessing PWA. Street View panorama → guess on a Leaflet
map → distance-based score. React + TypeScript (strict) + Vite, with Supabase as
the backend for everything official: profiles, private/party multiplayer, the
weekly leaderboard, the Daily Challenge and shared challenges. Solo play still
works with no backend at all (clearly marked as unranked).

## Key commands

```bash
npm run dev        # dev server
npm run test:e2e   # Playwright (production build; needs `npx playwright install`)
npm run build      # tsc -b && vite build (must pass before shipping)
npm run test       # Vitest unit tests
npm run lint       # ESLint (flat config)
npm run typecheck  # tsc -b, no emit
node scripts/generate-icons.mjs   # regenerate PWA icons (procedural PNGs)
```

Run **lint + typecheck + test + build** before considering a change done.

## Architecture

```
src/
  config/        app.ts (product name + tuning), env.ts (API key access)
  types/         shared TypeScript types
  data/          locations.ts (curated dataset — dev/tooling/offline; the
                 SERVER catalog in game_catalog is authoritative for official play)
  providers/     LocationProvider interface + static implementation
  official/      officialRun.ts (the answer-secrecy parser) + officialRunApi.ts
  daily/         daily.ts (UTC day, countdown, tie rules) + dailyApi + useDaily
  challenge/     challengeCode.ts (codes + deep links) + challengeApi
  share/         share.ts (Web Share → clipboard → execCommand fallbacks)
  game/          state.ts (state machine types) + reducer.ts (pure) + tests
  utils/         distance.ts, score.ts, selectRounds.ts (+ tests)
  hooks/         useGoogleMaps (singleton loader), useLocalStorage,
                 useMediaQuery, useOnlineStatus
  components/    street/ (StreetView), map/ (WorldMap, MapPanel),
                 hud/, settings/, ui/ (Button, Modal, StatusScreen, …)
  screens/       Welcome, Game, Final, Setup, Error, Daily, Challenge
  styles/        variables.css (design tokens), global.css
  App.tsx        top-level wiring; main.tsx entry
```

State is an explicit reducer state machine (`welcome → loadingRound →
exploring → selectingGuess → roundResult → finalResult`, plus `error`). Keep the
reducer pure and unit-tested; compute distance/score with the tested utils and
pass results into `SUBMIT_GUESS`.

## Server authority (V5)

Official online play — solo runs, the Daily Challenge, shared challenges — gets
its rounds from `public.game_catalog` through `SECURITY DEFINER` RPCs. The client
never sees a round's answer until it has guessed that round, never computes a
score for an official round, and never sends a location manifest. See
`docs/ENGAGEMENT_CORE_V5.md`; the guarantees are asserted in
`supabase/tests/09`–`11_*_verify.sql`, runnable with
`supabase/tests/run-local.sh`.

The bundled catalog remains the source for development, the audit tooling, the
seed generator, unit tests, and **offline Classic Solo**, which is always marked
local/non-official.

## Non-negotiable rules

1. **Preserve the single Street View instance.** There must be exactly ONE
   `google.maps.StreetViewPanorama` for the whole game. Create it once, store it
   in a ref, and only ever call `setPano` / `setPov` to change rounds. Never
   recreate it on rerender, and keep the ref/singleton guards that make React
   Strict Mode safe. Panorama loads are billable — this is the core cost control.
2. **Google Maps only for Street View.** The guess/result maps use Leaflet +
   OpenStreetMap. Do not add Google Maps to them.
3. **Never commit an API key.** The key comes from `VITE_GOOGLE_MAPS_API_KEY`
   via `.env.local` (git-ignored). The app must build/run/test without it.
4. **Product name in one place.** Only `src/config/app.ts` hard-codes "Roam".
5. **Provider boundary.** Game logic depends on `LocationProvider`, not on the
   dataset directly, so locations can later move to a backend.
6. **Never widen what a client learns about an un-played round.** One function
   server-side (`roam_run_payload`) and one parser client-side
   (`src/official/officialRun.ts`) form the whole reveal boundary — change either
   only with a matching SQL assertion.
7. **Migrations are additive and never edited after deploy.** New behaviour goes
   in a `*_v2` function so the previously deployed frontend keeps working while
   the database is ahead of it.

## Design rules

- Dark, cinematic; one warm-lime accent (`--accent`); translucent panels over
  the panorama; subtle blur/borders/short animations. Tokens in
  `styles/variables.css`.
- Mobile-first and responsive: `100dvh`, `env(safe-area-inset-*)`, no page
  scroll during play, ≥44px touch targets, `clamp()` typography, no hover-only
  interactions, respect `prefers-reduced-motion`.
- Accessibility: focus-visible outlines, focus trap in the modal, ARIA labels,
  keyboard support.

## Gotchas

- `vite.config.ts` and `vitest.config.ts` are **separate** on purpose (Vitest
  bundles its own Vite; merging them causes plugin type clashes).
- PWA caches only the app shell. Never precache Street View or map tiles, and
  don't imply they work offline.
- CSS Modules everywhere for components; keep global CSS to tokens + resets.

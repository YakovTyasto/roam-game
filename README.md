# Roam

A responsive, installable **geography guessing game** (PWA). You're dropped into
a Google Street View panorama somewhere in the world — look around, then drop a
pin on the map to guess where you are. Five rounds, up to **25,000 points**.

> The product name lives in a single file (`src/config/app.ts`). Change `APP.name`
> there to rename the whole game.

- Original travel-game aesthetic — not affiliated with, and not a copy of, any
  existing location-guessing product.
- Google Street View is used **only** for the panorama. The guessing and result
  maps use **Leaflet + OpenStreetMap** (no key required).
- **Optional private 1v1 multiplayer** (Supabase): play a friend in real time on
  the same locations. Entirely optional — solo mode works with no backend. See
  [`docs/MULTIPLAYER_SETUP.md`](docs/MULTIPLAYER_SETUP.md).

---

## Tech stack

React 18 · TypeScript (strict) · Vite 6 · Leaflet · Lucide icons ·
vite-plugin-pwa · Vitest · ESLint. Solo play needs no backend, accounts, or
database. Optional multiplayer adds **Supabase** (Postgres + Row Level Security +
Realtime + anonymous auth), loaded on demand via a code-split chunk so the solo
bundle stays lean.

## Requirements

- **Node 20.19+ or 22.12+** (Vite 6 requirement). Developed on Node 22.
- npm (bundled with Node).

## Install & run

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
```

Other commands:

```bash
npm run build      # type-check + production build
npm run preview    # preview the production build locally
npm run test       # run unit tests (Vitest)
npm run lint       # run ESLint
npm run typecheck  # type-check only
```

The app **runs without a Google API key** — you'll see a polished setup screen
explaining how to add one. Everything else (UI, maps, tests, build) works.

---

## Google Street View setup

The panorama needs a Google Maps **browser** API key.

### 1. Create a Google Cloud project
Go to <https://console.cloud.google.com/>, then **Select a project → New project**.

### 2. Enable billing and the Maps JavaScript API
- **Billing:** Console → **Billing** → link a billing account. Google offers
  monthly free usage; beyond it, Street View loads are billed per request — which
  is exactly why this app reuses a single panorama (see below).
- **API:** Console → **APIs & Services → Library → Maps JavaScript API → Enable.**
  (Street View is part of the Maps JavaScript API; no separate API is needed.)

### 3. Create an API key
Console → **APIs & Services → Credentials → Create credentials → API key.**

### 4. Restrict the key
Open the key and set both restrictions:

- **Application restrictions → HTTP referrers (web sites):**
  - Development: `http://localhost:5173/*`
  - Production: `https://your-domain.example/*`
- **API restrictions → Restrict key → Maps JavaScript API** (only).

> A browser API key is **always visible** to end users — it ships in the page.
> Referrer + API restrictions are the real protection. You cannot secure a
> browser key by hiding it in source code, and this project does not try to.

### 5. Add the key locally

Create **`.env.local`** in the project root (this exact filename):

```bash
cp .env.example .env.local
```

```dotenv
VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

Restart `npm run dev` so Vite picks up the variable. `.env` and `.env.local`
are git-ignored — **never commit a real key.**

---

## Google Street View cost optimisation

Street View panorama loads are billable, so the app is built to minimise them:

- **One panorama, reused.** A single `google.maps.StreetViewPanorama` is created
  **once** and stored in a ref (`src/components/street/StreetView.tsx`). All five
  rounds reuse it.
- **Reposition, don't recreate.** Changing rounds calls `setPano` / `setPov` on
  the existing instance. The panorama is never destroyed and rebuilt.
- **Rerender-safe.** The instance is guarded by a ref, so React rerenders never
  create a second panorama.
- **Strict-Mode-safe.** The Google Maps script is loaded through a **module-level
  singleton promise** (`src/hooks/useGoogleMaps.ts`), so React 18 Strict Mode's
  double-invoked effects still result in exactly one script load and one
  panorama.
- **Leaflet for guessing.** The guess and result maps use OpenStreetMap tiles, so
  interacting with the map costs nothing on the Google side. The Leaflet map is
  also created once and kept mounted for the whole game.
- **Nearest-panorama lookups only when the location changes**, with a small set
  of fallback radii; if none is found the location is swapped for a spare and
  retried gracefully.

## Private multiplayer (optional)

Play a friend 1v1 in real time on the same five locations:

- **Create or join** a private room with a six-character code or an invite link
  (`/?room=ABC234`). Names are anonymous — no accounts.
- **Same locations, same order.** The host generates a validated round manifest
  (real resolved panoramas + a fixed heading) once; both clients load the
  identical panorama.
- **Guess independently.** You never see the opponent's guess before you submit;
  results reveal after both submit or the server-authoritative timer expires.
- **Trusted server.** Scores are computed in Postgres with the exact solo
  formula, Row Level Security hides answers/opponent guesses until the reveal,
  and all writes go through transactional RPCs. Reconnect after a refresh.

This is a friends-only MVP, not an anti-cheat system — see the honest trust-model
note in [`docs/MULTIPLAYER_SETUP.md`](docs/MULTIPLAYER_SETUP.md), which has the
full Supabase + Vercel setup, the SQL migrations to apply, and troubleshooting.

Architecture lives under `src/multiplayer/` (typed client, API/repository,
domain types, state machine, and the `useMultiplayer` hook) and
`src/screens/multiplayer/` (menu, lobby, game, final). The database schema, RLS
policies, and RPCs are in `supabase/migrations/`, with a runnable verification
script in `supabase/tests/`.

## Build & preview production

```bash
npm run build
npm run preview
```

## Deploy

The output is a static site in `dist/`.

**Vercel**
1. Import the repo at <https://vercel.com/new>.
2. Framework preset **Vite**, build `npm run build`, output `dist`.
3. Add the env var `VITE_GOOGLE_MAPS_API_KEY` (Project → Settings → Environment
   Variables) and redeploy.
4. Add your Vercel domain to the key's HTTP-referrer restrictions.

**Cloudflare Pages**
1. Create a Pages project from the repo.
2. Build command `npm run build`, output directory `dist`.
3. Add `VITE_GOOGLE_MAPS_API_KEY` under Settings → Environment variables.
4. Add your `pages.dev` / custom domain to the key's referrer restrictions.

## Locations

~50 curated, globally distributed locations live in `src/data/locations.ts`,
behind a provider interface (`src/providers/LocationProvider.ts`) so they can
move to a backend later without touching game logic. Five unique locations are
chosen per game; before a round starts the app finds the nearest real panorama
and skips gracefully to a spare if none exists.

> **Note:** location data is bundled with the client, so a determined user could
> read the coordinates from the app bundle. That's an accepted trade-off for this
> MVP; moving locations behind the provider's network implementation would remove
> it.

## Known MVP limitations

- Solo scores/preferences are stored in `localStorage` (per browser, not synced).
- Location data is client-side and therefore inspectable (see above). In
  multiplayer the answer is withheld by RLS until the reveal, but the active
  round's panorama id is necessarily on the client to render it — a
  sophisticated player could resolve it back to coordinates. It's a friends-only
  MVP, not anti-cheat (details in `docs/MULTIPLAYER_SETUP.md`).
- Multiplayer anonymous identity lives in the browser; clearing site data or
  switching devices creates a new identity that can't rejoin as the same player.
- The PWA caches only the **app shell** — Street View and map tiles require a
  network connection and are intentionally **not** available offline.
- No anti-cheat (e.g. against reading bundled coordinates or the browser
  console).
- Street View coverage and available navigation vary by location and change over
  time.

## Sensible next steps (not implemented)

- Move locations behind a backend implementation of `LocationProvider`.
- Game modes: timed/blitz, no-move/no-pan, region-restricted.
- Server-validated scoring and optional accounts/leaderboards.
- Shareable result cards and round replays.
- Richer accessibility pass and i18n.

## Testing

Unit tests (Vitest) cover the pure logic:

- Haversine distance (`src/utils/distance.test.ts`)
- Exponential scoring (`src/utils/score.test.ts`)
- Unique round selection (`src/utils/selectRounds.test.ts`)
- Game reducer / state transitions (`src/game/reducer.test.ts`)
- Multiplayer: room-code + name validation, invite-link parsing, timer-expiry
  decisions, snapshot reconciliation (out-of-order), the room state machine,
  winner/draw + round breakdown, manifest validation, missing-config handling,
  and **TS↔SQL scoring parity** (`src/multiplayer/*.test.ts`)

```bash
npm run test
```

The database guarantees (max two players, host-only start, one guess per round,
hidden targets/opponent guesses, no direct score edits, safe duplicate
advancement, timer enforcement) have a runnable SQL verification script — see
[`supabase/tests/README.md`](supabase/tests/README.md).

## License

MIT (see `package.json`). Map data © OpenStreetMap contributors. Street View
imagery © Google.

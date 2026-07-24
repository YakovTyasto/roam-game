# CLAUDE.md

Guidance for working in this repository.

## What this is

**Roam** — a single-player geography guessing PWA. Street View panorama →
guess on a Leaflet map → distance-based score, five rounds. React + TypeScript
(strict) + Vite. No backend.

## Key commands

```bash
npm run dev        # dev server
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
  data/          locations.ts (curated dataset)
  providers/     LocationProvider interface + static implementation
  game/          state.ts (state machine types) + reducer.ts (pure) + tests
  utils/         distance.ts, score.ts, selectRounds.ts (+ tests)
  hooks/         useGoogleMaps (singleton loader), useLocalStorage,
                 useMediaQuery, useOnlineStatus
  components/    street/ (StreetView), map/ (WorldMap, MapPanel),
                 hud/, settings/, ui/ (Button, Modal, StatusScreen, …)
  screens/       Welcome, Game, Final, Setup, Error
  styles/        variables.css (design tokens), global.css
  App.tsx        top-level wiring; main.tsx entry
```

State is an explicit reducer state machine (`welcome → loadingRound →
exploring → selectingGuess → roundResult → finalResult`, plus `error`). Keep the
reducer pure and unit-tested; compute distance/score with the tested utils and
pass results into `SUBMIT_GUESS`.

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

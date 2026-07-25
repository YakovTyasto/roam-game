# PWA installation & update — manual test checklist

Automated tests cover the pure config/logic (`src/pwa/pwaInstall.test.ts`);
actual install behavior varies enough by OS/browser that it needs a manual
pass before shipping a PWA-affecting change.

## iOS (Safari)

1. Open the deployed URL in **Safari** (not Chrome — iOS only allows Safari
   to install PWAs to the home screen).
2. Tap the **Share** icon → **Add to Home Screen**.
3. Confirm: the app icon (not a generic globe) appears, the name reads
   "Roam", and launching from the home screen opens **without** Safari's
   URL bar/chrome (`display: standalone` respected).
4. Confirm the status bar area doesn't overlap the HUD (safe-area insets —
   check both portrait and landscape, notch and non-notch devices if
   available).
5. Force-quit and relaunch from the home screen — confirm it reopens to the
   Welcome screen (not a blank/error state).
6. Open **Settings** in-app → confirm the "Install Roam" hint does **not**
   appear (already installed / running standalone).

## Android (Chrome)

1. Open the deployed URL in Chrome. Chrome should offer its own native
   "Install app" prompt/menu item (separate from this app's in-Settings
   hint — both are expected to coexist; this app's hint is a fallback for
   browsers without a native prompt).
2. Install and confirm standalone launch, icon, and name as above.

## Desktop (Chrome / Edge)

1. Open the deployed URL. Look for the install icon in the omnibox
   (Chrome/Edge address bar).
2. Install, then confirm the app opens in its own window (no browser
   chrome/tabs) and the icon appears correctly in the OS taskbar/dock.

## Update flow (any platform)

1. Deploy a small, visible change (e.g. a copy tweak).
2. With the app already installed/open from before the deploy, wait for the
   service worker to pick up the new version (or trigger a reload/refocus —
   workbox checks on navigation).
3. Confirm the **"A new version is available" / Update** banner appears
   (bottom of screen) — the app must **not** silently reload out from under
   the player mid-session (`registerType: 'prompt'` in `vite.config.ts`,
   wired through `src/pwa/useServiceWorkerUpdate.ts`).
4. Tap **Update** → confirm the page reloads and the new version is live.
5. Tap the dismiss (×) instead → confirm the banner closes and the player
   can keep playing on the old version without being interrupted again this
   session.

## Offline behavior

1. Load the app once while online (so the service worker installs and
   precaches the app shell).
2. Go offline (airplane mode / devtools "Offline" throttling).
3. Reload — confirm the app shell (Welcome screen, Settings, static UI)
   still loads instead of a browser offline error page.
4. Confirm the **offline banner** appears ("You're offline. Street View and
   map tiles need a connection.") and that starting a game surfaces a clear
   error rather than a silent hang, since Street View/map tiles/Supabase
   RPCs are all network-dependent and intentionally **not** cached or
   claimed to work offline.

## What's cached vs. not (verify via DevTools → Application → Cache Storage)

- **Cached (app shell):** HTML/CSS/JS bundles, the manifest, and local
  static assets (icons, fonts if any) — see `globPatterns` in
  `vite.config.ts`.
- **Never cached:** Google Maps/Street View script and panorama imagery,
  OpenStreetMap tiles, Supabase authenticated responses/RPC results/Realtime
  traffic. Confirm none of these show up under Cache Storage — the
  `runtimeCaching: []` in `vite.config.ts` is deliberate.

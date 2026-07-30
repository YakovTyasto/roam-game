# Browser regression tests

Playwright tests that run against the **production build**, because the bug
they cover lived in built CSS and only appears at a real phone viewport.

```bash
npx playwright install          # once — downloads WebKit and Chromium
npm run test:e2e                # every project
npm run test:e2e:mobile         # iPhone + iPad WebKit only
```

`npm run test:e2e` builds the app and serves it on port 4173 itself; no
separate server step is needed.

## Specs

| Spec | What it guards |
| --- | --- |
| `modeButton.spec.ts` | The original iPhone Safari hotfix: mode/Play/Start controls reachable by a finger |
| `mobileInteraction.spec.ts` | The wider Priority-0 gate — settings, private multiplayer entry, create/join, back-home, exit-game, overlays, hung backend, fixed banners, service-worker load |

## The stub harness (`e2e/support/`)

The e2e build is a **fully configured** app: `playwright.config.ts` bakes in a
Google Maps key and a Supabase URL so the suite drives the real configured
screens instead of only the "backend missing" fallbacks. Neither value reaches a
real service:

- `VITE_SUPABASE_URL` is **same-origin** (`http://localhost:4173/__supabase`),
  so there is no CORS preflight and every call is intercepted in Node by
  `support/supabase.ts`. Declare the `supabase` fixture in a test to inspect
  which RPCs the UI called, reprogram one, or make the whole backend hang/fail.
- `maps.googleapis.com` is intercepted by `support/googleMaps.ts`, which serves a
  tiny stand-in for the Maps JS API. **No billable panorama is ever loaded**, and
  the app code under test is unmodified — it still creates exactly one
  `StreetViewPanorama` and still calls `setPano`/`setPov`, which is why
  `mobileInteraction.spec.ts` can assert the single-instance cost rule from a
  real browser.
- OpenStreetMap tiles are served as a 1×1 PNG.

Run the suite **without a `.env.local`**: Vite's env files take precedence over
the process env, so a local file would override the stub configuration. CI has
none.

The stub is not a second implementation of the SQL. Server authority,
idempotency and answer secrecy are proven by `supabase/tests/*.sql`; the stub
only answers plausibly enough to drive the UI.

## Projects

| Project | Engine | Viewport | Why |
| --- | --- | --- | --- |
| `iphone-webkit` | WebKit | iPhone 13, touch | The reported bug was iPhone Safari |
| `ipad-webkit` | WebKit | iPad gen 7, touch | Tablet height did *not* reproduce it — guards the boundary |
| `desktop-chromium` | Chromium | 1280×720, mouse | Mouse, keyboard and focus paths |
| `iphone-chromium` | Chromium | 390×664, touch | Cross-engine control |
| `ipad-chromium` | Chromium | 810×1080, touch | Cross-engine control |

## What these tests refuse to do

**They never use `locator.tap()` or `locator.click()` on the button under
test.** Both scroll the target into view first, and that auto-scroll can move a
container a finger cannot — it reported success against the broken build. Every
activation goes through `page.touchscreen.tap(x, y)` (or `page.mouse.click` on
non-touch projects) at the button's real coordinates, after
`document.elementFromPoint()` confirms the button is what is actually there.

**They never call `scrollIntoView()`.** The helper first asserts a scrollable
ancestor exists — precisely what the bug removed — and only then scrolls it,
positioning the element rather than jumping to the bottom, so a control near the
top is proven reachable too.

Removing either of those guards would make the suite pass against the bug it
exists to catch.

## Sandboxes without a WebKit build

Some environments block the Playwright browser CDN, so `npx playwright install
webkit` fails and the two WebKit projects error with `Executable doesn't
exist`. The Chromium projects cover the same assertions at the same viewports
and can be pointed at a pre-installed binary:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  npx playwright test --project=iphone-chromium --project=ipad-chromium --project=desktop-chromium
```

(Point it at the real binary, not the install directory — Playwright reports
`Failed to launch chromium because executable doesn't exist` for a directory.)

That is a fallback, not a substitute: WebKit is the engine the bug was reported
on, and CI should run the WebKit projects.

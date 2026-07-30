import { defineConfig, devices } from '@playwright/test';

/**
 * Browser regression tests for the mobile mode-button hotfix.
 *
 * The bug this suite exists for was invisible to unit tests and to desktop
 * browsers: menu screens rendered taller than the viewport inside a clipped,
 * non-scrollable root, so the primary action button sat below the fold with no
 * way for a finger to reach it. Only a real engine at a real phone viewport
 * reproduces that, which is why this runs against the production build.
 *
 * WebKit is the engine that matters here, because the report is iPhone Safari.
 * Chromium projects run the same assertions as a cross-engine control.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` lets a sandbox point at a pre-installed Chromium
 * when the bundled browser download is unavailable. Unset in CI, where
 * `npx playwright install` provides the matching builds.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const chromiumLaunch = chromiumPath ? { executablePath: chromiumPath } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serve the real production build, not the dev server — the bug lived in
  // built CSS, and dev-only behaviour would not be representative.
  //
  // The build is configured as a *fully set up* app: a Google Maps key and a
  // Supabase URL are baked in so the suite exercises the real configured
  // screens (official runs, Daily, multiplayer menu) rather than only the
  // "backend missing" fallbacks. Neither value reaches a real service:
  //   • the Supabase URL is same-origin (`/__supabase`), so there is no CORS
  //     preflight and every call is intercepted by e2e/support/supabase.ts;
  //   • the Maps key is a placeholder and maps.googleapis.com is intercepted by
  //     e2e/support/googleMaps.ts, so no billable panorama is ever loaded.
  // A local `.env.local` would take precedence over these (Vite loads env files
  // after process env), so run the suite without one — CI has none.
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_GOOGLE_MAPS_API_KEY: 'e2e-stub-maps-key',
      VITE_SUPABASE_URL: 'http://localhost:4173/__supabase',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-stub-publishable-key',
    },
  },

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 13'], hasTouch: true, isMobile: true },
    },
    {
      name: 'ipad-webkit',
      use: { ...devices['iPad (gen 7)'], hasTouch: true },
    },
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumLaunch,
      },
    },
    // Cross-engine controls at the same viewports. These are also the only
    // touch projects that can run in sandboxes where the WebKit build cannot
    // be downloaded, so the suite still guards the regression there.
    {
      name: 'iphone-chromium',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 664 },
        hasTouch: true,
        isMobile: true,
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: 'ipad-chromium',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        isMobile: false,
        launchOptions: chromiumLaunch,
      },
    },
  ],
});

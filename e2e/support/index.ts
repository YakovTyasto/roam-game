import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installGoogleMapsStub } from './googleMaps';
import { installSupabaseStub, type SupabaseStub } from './supabase';
import { tapForReal } from './touch';

export * from './touch';
export { installGoogleMapsStub } from './googleMaps';
export { installSupabaseStub, type SupabaseStub, type RpcHandler } from './supabase';
export { expect };

/**
 * Every spec gets the network stubs installed before it navigates — routes must
 * exist before the first request, so this is an `auto` fixture rather than
 * something each test remembers to call.
 *
 * Declare `supabase` in the test's arguments when you need to inspect or
 * reprogram the backend; ignore it and the healthy defaults apply.
 */
export const test = base.extend<{ supabase: SupabaseStub }>({
  supabase: [
    async ({ page }, use) => {
      await installGoogleMapsStub(page);
      const stub = await installSupabaseStub(page);
      await use(stub);
    },
    { auto: true },
  ],
});

export const TEST_PLAYER_NAME = 'Tester';

/**
 * Wait until the app has decided what to show first.
 *
 * With a backend configured, the profile bootstrap briefly covers the app with a
 * loading layer, so "is the name screen showing?" is not answerable the instant
 * navigation finishes. Racing that check is how a suite ends up asserting
 * against a spinner and reporting nonsense.
 */
export async function waitForFirstScreen(page: Page): Promise<void> {
  // "Any button is on screen" is the right signal here rather than a specific
  // one: the first screen depends on how the app was opened (home, a challenge
  // deep link, a room invite), while the loading layer has no buttons at all.
  await expect(page.getByRole('button').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * First visit asks for a display name before anything else renders. Idempotent:
 * returns immediately when the name screen isn't showing.
 */
export async function completeOnboarding(page: Page, name = TEST_PLAYER_NAME): Promise<void> {
  await waitForFirstScreen(page);
  const nameInput = page.getByLabel('Your display name');
  if ((await nameInput.count()) === 0) return;
  await nameInput.fill(name);
  await tapForReal(page, page.getByRole('button', { name: /start exploring/i }), 'Start exploring');
  // Onboarding is done when the name screen is gone. Asserting on the *home*
  // screen instead would be wrong for a deep link, which opens elsewhere.
  await expect(nameInput).toBeHidden();
}

/** Load the app and get past onboarding to the home screen. */
export async function openHome(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await completeOnboarding(page);
}

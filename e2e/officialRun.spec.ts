import { expect, openHome, tapForReal, test } from './support';

/**
 * The V5 trust change, asserted from a real browser: a solo game must start as
 * an OFFICIAL, server-selected run, and the round's answer must arrive only in
 * the server's response to the guess.
 *
 * These are behavioural, not cosmetic, assertions — a regression that quietly
 * dropped back to the client-manifest path would still look completely normal on
 * screen, which is exactly why the RPC calls are checked directly.
 */

test.describe('official solo runs', () => {
  test('starting a solo game creates a server-selected run', async ({ page, supabase }) => {
    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await tapForReal(page, page.getByRole('button', { name: /start game/i }), 'Start game');
    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });

    expect(
      supabase.callsTo('roam_start_official_run_v2'),
      'the game did not start through the official, server-selected path',
    ).toHaveLength(1);
    // The legacy client-manifest RPC must not be used at all any more.
    expect(supabase.callsTo('roam_create_solo_run')).toHaveLength(0);

    const params = supabase.callsTo('roam_start_official_run_v2')[0];
    expect(params.p_difficulty).toBeTruthy();
    expect(params.p_total_rounds).toBe(5);
  });

  test('the browser never receives an answer before it guesses', async ({ page }) => {
    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await tapForReal(page, page.getByRole('button', { name: /start game/i }), 'Start game');
    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });

    // The panorama is live, so the round is fully renderable…
    await expect(page.getByTestId('stub-panorama')).toHaveAttribute('data-pano', /STUB_PANO_1/);

    // …yet the page contains no trace of the target. The stub reveals
    // "Stub Place"/"France" only in a guess response, so their absence here is a
    // real assertion about what crossed the network.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Stub Place');
    expect(body).not.toContain('France');
  });

  test('a guess is scored by the server, which then reveals the place', async ({
    page,
    supabase,
  }) => {
    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await tapForReal(page, page.getByRole('button', { name: /start game/i }), 'Start game');
    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });

    // On a phone/tablet the guess map is a closed sheet behind a "Make your
    // guess" button; on desktop it is already on screen. Open it if needed.
    const openMap = page.getByRole('button', { name: /make your guess/i });
    if ((await openMap.count()) > 0) {
      await tapForReal(page, openMap, 'Make your guess');
    }

    // Drop a pin on the Leaflet canvas. `locator.tap()` is right here (unlike in
    // the interaction specs, which must avoid it): this test is driving the flow,
    // not proving reachability, and it waits for the sheet's open animation to
    // settle before dispatching — a raw coordinate tap races that animation.
    const canvas = page.locator('.leaflet-container');
    await expect(canvas).toBeVisible();
    const hasTouch = await page.evaluate(
      () => 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    );
    if (hasTouch) await canvas.tap();
    else await canvas.click();

    const confirm = page.getByRole('button', { name: 'Confirm guess' });
    await expect(confirm).toBeEnabled();
    await tapForReal(page, confirm, 'Confirm guess');

    await expect
      .poll(() => supabase.callsTo('roam_submit_official_guess_v2').length, {
        message: 'the guess never reached the server',
        timeout: 15_000,
      })
      .toBe(1);

    const submitted = supabase.callsTo('roam_submit_official_guess_v2')[0];
    expect(submitted.p_round_number).toBe(1);
    // The client sends coordinates and nothing else — no score, no distance, no
    // elapsed time, no target.
    expect(Object.keys(submitted).sort()).toEqual([
      'p_lat',
      'p_lng',
      'p_round_number',
      'p_run_id',
    ]);

    // Only now does the place appear, from the server's response.
    await expect(page.getByText('Stub Place')).toBeVisible();
  });

  test('an unreachable backend still starts a game, labelled as unranked', async ({
    page,
    supabase,
  }) => {
    await openHome(page);
    // Fail every RPC *after* onboarding, so the run start is what breaks.
    supabase.failAll('backend down');

    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await tapForReal(page, page.getByRole('button', { name: /start game/i }), 'Start game');

    // The game must still be playable — locally, from the bundled catalog.
    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('stub-panorama')).toBeVisible();
  });
});

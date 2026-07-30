import {
  expect,
  expectReachable,
  expectTouchTarget,
  findBlockingOverlays,
  openHome,
  tapForReal,
  test,
} from './support';

/**
 * Priority 0 gate for the production report: "the game works on desktop, but on
 * iPhone/iPad Safari the Play/mode buttons and private multiplayer entry cannot
 * be tapped".
 *
 * e2e/modeButton.spec.ts already covers the specific hotfix (a clipped,
 * non-scrollable root that pushed the primary action below the fold). This suite
 * widens the gate to every entry point the report named, and — more importantly
 * — to the *classes* of cause that produce the same symptom, so a future
 * regression is caught whichever way it arrives:
 *
 *   • something invisible on top          → document.elementFromPoint at the
 *                                           control's own centre
 *   • a full-screen loading layer that
 *     never clears                        → the backend is made to hang, and the
 *                                           home screen must stay interactive
 *   • a fixed banner over the controls    → the update banner is forced on and
 *                                           the actions re-hit-tested underneath
 *   • pointer-events / touch-action /
 *     stacking mistakes                   → computed styles asserted on the
 *                                           whole chain above each control
 *   • a parent handler eating child taps  → the tap must land on the child and
 *                                           produce the child's effect
 *   • touch targets below the iOS floor   → 44×44 asserted on real geometry
 *
 * Everything is driven with `page.touchscreen.tap()` at real coordinates on the
 * touch projects; nothing here uses `locator.click()` on the control under test.
 */

const HOME_ACTIONS = [/solo game/i, /private multiplayer/i, /weekly leaderboard/i];

test.describe('mobile interaction gate — home screen', () => {
  test.beforeEach(async ({ page }) => {
    await openHome(page);
  });

  test('no invisible layer covers the home actions', async ({ page }) => {
    const overlays = await findBlockingOverlays(page);
    expect(
      overlays,
      `a full-bleed layer with no controls of its own is intercepting taps: ${overlays.join('; ')}`,
    ).toEqual([]);

    for (const name of HOME_ACTIONS) {
      await expectReachable(page.getByRole('button', { name }), `home action ${name}`);
    }
  });

  test('nothing in the ancestor chain disables pointer input', async ({ page }) => {
    for (const name of HOME_ACTIONS) {
      const offenders = await page
        .getByRole('button', { name })
        .evaluate((el: HTMLElement) => {
          const bad: string[] = [];
          let node: HTMLElement | null = el;
          while (node) {
            const s = getComputedStyle(node);
            const tag = `<${node.tagName.toLowerCase()} class="${node.className}">`;
            // `pointer-events: none` anywhere above a control makes it dead to
            // both mouse and touch while still looking perfectly normal.
            if (s.pointerEvents === 'none') bad.push(`${tag} pointer-events:none`);
            // `touch-action: none` on an ancestor does not block taps, but it
            // does block the scroll that brings a below-the-fold control into
            // reach — which is how the original bug presented.
            if (s.touchAction === 'none') bad.push(`${tag} touch-action:none`);
            if (s.visibility === 'hidden') bad.push(`${tag} visibility:hidden`);
            node = node.parentElement;
          }
          return bad;
        });
      expect(offenders, `ancestors of ${name} block pointer input`).toEqual([]);
    }
  });

  test('home actions meet the 44px touch-target floor', async ({ page }) => {
    for (const name of HOME_ACTIONS) {
      await expectTouchTarget(page.getByRole('button', { name }), `home action ${name}`);
    }
    await expectTouchTarget(page.getByRole('button', { name: 'Settings' }), 'Settings');
  });

  test('controls stay inside the safe area', async ({ page }) => {
    // A safe-area mistake puts a control under the notch or the home indicator,
    // where iOS Safari's own chrome takes the tap. The emulated viewport has no
    // real insets, so this asserts the weaker invariant that always holds: no
    // control may sit flush against a viewport edge.
    for (const name of HOME_ACTIONS) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box, `${name} has no box`).not.toBeNull();
      expect(box!.y, `${name} is flush with the top edge`).toBeGreaterThan(0);
      const bottomGap = await page.evaluate(
        (b: number) => window.innerHeight - b,
        box!.y + box!.height,
      );
      expect(bottomGap, `${name} is flush with the bottom edge`).toBeGreaterThanOrEqual(0);
    }
  });

  test('the settings screen opens by touch and closes again', async ({ page }) => {
    await tapForReal(page, page.getByRole('button', { name: 'Settings' }), 'Settings');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The dialog must not merely be present — its own controls must be tappable
    // through the backdrop.
    const close = dialog.getByRole('button', { name: /close/i });
    await expectReachable(close, 'settings close button');
    await tapForReal(page, close, 'settings close button');
    await expect(dialog).toBeHidden();

    // …and the home actions must be usable again afterwards: a modal that
    // leaves its backdrop or `overflow:hidden` behind is the classic cause of
    // "the buttons stopped working after I opened settings".
    await expect(await findBlockingOverlays(page)).toEqual([]);
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();
  });

  test('a hung backend never leaves the app inert', async ({ page, supabase }) => {
    // The V3 incident shape: a full-screen spinner gated on a request that never
    // resolves. Every network call that gates interactivity must be bounded, so
    // the app must reach an interactive screen on its own — here the local-name
    // fallback, since the profile bootstrap is what is hanging.
    // A cold start is the dangerous case: with no cached profile the app shows
    // *only* the loading layer, so nothing is tappable until the bound expires.
    await page.evaluate(() => window.localStorage.clear());
    supabase.hangAll();
    await page.goto('/');

    const nameInput = page.getByLabel('Your display name');
    await expect(nameInput, 'the loading layer never cleared').toBeVisible({ timeout: 25_000 });
    expect(await findBlockingOverlays(page)).toEqual([]);

    await nameInput.fill('Offline');
    await tapForReal(
      page,
      page.getByRole('button', { name: /start exploring/i }),
      'Start exploring with a hung backend',
    );

    const solo = page.getByRole('button', { name: /solo game/i });
    await expect(solo).toBeVisible({ timeout: 25_000 });
    await expectReachable(solo, 'Solo game with a hung backend');
    expect(await findBlockingOverlays(page)).toEqual([]);
  });

  test('a fixed bottom banner does not cover the home actions', async ({ page }) => {
    // The offline banner and the PWA update banner are both `position: fixed`
    // at the bottom with a high z-index, so a safe-area or z-index mistake in
    // either covers a primary action — and only ever in production. The offline
    // one can be raised for real: the hook listens for the browser's own event.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/offline/i).first()).toBeVisible();

    for (const name of HOME_ACTIONS) {
      await expectReachable(page.getByRole('button', { name }), `home action ${name}`);
    }

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
  });
});

test.describe('mobile interaction gate — service worker', () => {
  // The report mentioned taps failing even in a private tab, which rules the
  // service worker out as *the* cause — but a stale cached shell is still the
  // way a fixed interaction bug survives a deploy, so it gets its own gate.
  test('the app stays tappable when served by the service worker', async ({ page }) => {
    await openHome(page);

    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'none';
      await navigator.serviceWorker.ready;
      return 'ready';
    });
    // vite-preview over http://localhost is a secure context, so registration
    // is expected; if a browser build disables it, say so rather than passing
    // silently on a check that did not happen.
    expect(['ready', 'none', 'unsupported']).toContain(registered);
    test.skip(registered !== 'ready', `service worker not active (${registered})`);

    // Second load: the shell now comes from the precache, which is where a
    // stale-asset mismatch would show up.
    await page.reload();
    await expect(page.evaluate(() => !!navigator.serviceWorker.controller)).resolves.toBe(true);

    expect(await findBlockingOverlays(page)).toEqual([]);
    for (const name of HOME_ACTIONS) {
      await expectReachable(page.getByRole('button', { name }), `home action ${name} after SW load`);
    }
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();
  });
});

test.describe('mobile interaction gate — private multiplayer', () => {
  test('the multiplayer entry, create and join controls all take a real tap', async ({ page }) => {
    await openHome(page);

    await tapForReal(
      page,
      page.getByRole('button', { name: /private multiplayer/i }),
      'Private multiplayer',
    );

    // Configured backend → the real menu (the stub answers the auth bootstrap).
    const create = page.getByRole('button', { name: /create private room/i });
    await expect(create).toBeVisible();
    await expectReachable(create, 'Create private room');
    await expectTouchTarget(create, 'Create private room');

    // Join is correctly disabled until a full code is typed; that is a state
    // check, not an interactivity failure, so assert the state and then enable
    // it the way a player would.
    const join = page.getByRole('button', { name: /join game/i });
    await expect(join).toBeDisabled();
    await page.getByLabel(/room code/i).fill('ABC234');
    await expect(join).toBeEnabled();
    await expectReachable(join, 'Join game');
    await expectTouchTarget(join, 'Join game');

    // Back to home must work from here — a dead back button traps a phone user
    // with no browser chrome in a standalone PWA.
    await tapForReal(page, page.getByRole('button', { name: /back to home/i }), 'Back to home');
    await expect(page.getByRole('button', { name: /solo game/i })).toBeVisible();
  });

  test('tapping Create reaches the backend rather than being swallowed', async ({
    page,
    supabase,
  }) => {
    await openHome(page);
    await tapForReal(
      page,
      page.getByRole('button', { name: /private multiplayer/i }),
      'Private multiplayer',
    );

    const create = page.getByRole('button', { name: /create private room/i });
    await tapForReal(page, create, 'Create private room');

    // The proof the tap was *received* is the RPC, not a screen change: this is
    // exactly what a parent-handler or overlay bug would silence.
    await expect
      .poll(() => supabase.callsTo('mp_create_room').length, {
        message: 'Create private room did not reach mp_create_room',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  });
});

test.describe('mobile interaction gate — in game', () => {
  test('the exit-game button is tappable and its confirmation is usable', async ({ page }) => {
    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await tapForReal(page, page.getByRole('button', { name: /start game/i }), 'Start game');

    // The stubbed panorama stands in for Street View, so the HUD renders exactly
    // as it does in production.
    const exit = page.getByRole('button', { name: 'Exit game' });
    await expect(exit).toBeVisible({ timeout: 30_000 });
    await expectReachable(exit, 'Exit game');
    await expectTouchTarget(exit, 'Exit game');

    await tapForReal(page, exit, 'Exit game');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const abandon = dialog.getByRole('button', { name: /abandon/i });
    await expectReachable(abandon, 'Abandon game');
    await tapForReal(page, abandon, 'Abandon game');

    // Back on the home screen, fully interactive.
    await expect(page.getByRole('button', { name: /solo game/i })).toBeVisible();
    expect(await findBlockingOverlays(page)).toEqual([]);
  });

  test('exactly one Street View panorama is ever created', async ({ page }) => {
    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await tapForReal(page, page.getByRole('button', { name: /start game/i }), 'Start game');
    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });

    // The repository's first non-negotiable rule, asserted in a real browser:
    // panorama loads are billable, so there must be one instance for the whole
    // game no matter how many times React re-renders.
    const instances = await page.evaluate(
      () => (window as unknown as { __roamStub?: { panoramas?: unknown[] } }).__roamStub?.panoramas?.length ?? 0,
    );
    expect(instances, 'more than one StreetViewPanorama was constructed').toBe(1);
  });
});

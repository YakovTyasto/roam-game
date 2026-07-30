import { bringIntoReach, expect, openHome, tapForReal, test } from './support';

/**
 * Regression cover for the iPhone Safari hotfix: the buttons that pick and
 * start a game mode must be reachable and tappable with a real finger.
 *
 * The helpers this leans on live in e2e/support/touch.ts and are shared with
 * every later suite — see that file (and e2e/README.md) for why they refuse to
 * use `locator.tap()`, `locator.click()` or `scrollIntoView()` on the control
 * under test: all three auto-scroll, and all three reported success against the
 * broken build.
 */

test.describe('game mode buttons', () => {
  test.beforeEach(async ({ page }) => {
    await openHome(page);
  });

  test('every action on the home screen is reachable and responds', async ({ page }) => {
    for (const name of [/solo game/i, /private multiplayer/i, /weekly leaderboard/i]) {
      const button = page.getByRole('button', { name });
      await expect(button).toBeVisible();
      expect(
        await bringIntoReach(button),
        `home action ${name} cannot be brought into view`,
      ).not.toBeNull();
    }

    await tapForReal(page, page.getByRole('button', { name: /solo game/i }));
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();
  });

  test('difficulty cards select with a real tap', async ({ page }) => {
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }));
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();

    const cards = page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio');
    const count = await cards.count();
    expect(count).toBeGreaterThan(1);

    // Every card must be tappable, not just the one that happens to be on top.
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      await tapForReal(page, card);
      await expect(card).toHaveAttribute('aria-checked', 'true');
    }
  });

  test('round chips select with a real tap', async ({ page }) => {
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }));
    const chips = page.getByRole('radiogroup', { name: 'Rounds' }).getByRole('radio');
    const count = await chips.count();
    expect(count).toBeGreaterThan(1);

    for (let i = 0; i < count; i++) {
      const chip = chips.nth(i);
      await tapForReal(page, chip);
      await expect(chip).toHaveAttribute('aria-checked', 'true');
    }
  });

  test('Start game is reachable by touch and advances the screen', async ({ page }) => {
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }));

    const start = page.getByRole('button', { name: /start game/i });
    await expect(start).toBeVisible();

    // The regression itself: before the fix this returned null on a phone
    // viewport, because the screen grew past a clipped root that never scrolled.
    const point = await bringIntoReach(start);
    expect(point, '"Start game" is unreachable by touch').not.toBeNull();

    await tapForReal(page, start);
    // The e2e build has a (stubbed) Maps key, so the tap must actually start a
    // round: the in-game HUD is the proof. Its exit control is also the first
    // thing a player reaches for, so asserting on that covers both.
    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe('non-touch input still works', () => {
  test.skip(({ isMobile }) => !!isMobile, 'keyboard and mouse paths are desktop-only');

  test('mouse click opens solo setup', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: /solo game/i }).click();
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();
  });

  test('keyboard Enter and Space activate the mode buttons', async ({ page }) => {
    await openHome(page);

    await page.getByRole('button', { name: /solo game/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();

    // Space must work on the difficulty cards too — they are real buttons, so
    // this guards against anyone "fixing" touch by swapping in a div.
    const card = page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio').last();
    await card.focus();
    await page.keyboard.press(' ');
    await expect(card).toHaveAttribute('aria-checked', 'true');
  });

  test('focus-visible outline survives the fix', async ({ page }) => {
    await openHome(page);
    const button = page.getByRole('button', { name: /solo game/i });
    await page.keyboard.press('Tab');
    await button.focus();
    const outlined = await button.evaluate((el) => {
      el.focus();
      return getComputedStyle(el).outlineStyle !== 'none' || el.matches(':focus-visible');
    });
    expect(outlined).toBe(true);
  });
});

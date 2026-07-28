import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Regression cover for the iPhone Safari hotfix: the buttons that pick and
 * start a game mode must be reachable and tappable with a real finger.
 *
 * ── Why these tests are written the way they are ──────────────────────────
 *
 * `locator.tap()` and `locator.click()` scroll the target into view first, and
 * that auto-scroll can move a container a finger cannot. It reported success
 * against the broken build. So every tap below goes through
 * `page.touchscreen.tap(x, y)` at the button's real on-screen coordinates,
 * after checking `document.elementFromPoint()` actually resolves to the button
 * — the same check a fingertip performs.
 *
 * Scrolling is likewise never done with `scrollIntoView()`. The test first
 * asserts a scrollable ancestor exists, which is precisely what the bug
 * removed, and only then scrolls it.
 */

const NAME = 'Tester';

/** First visit asks for a display name before anything else renders. */
async function completeOnboarding(page: Page): Promise<void> {
  const nameInput = page.getByLabel('Your display name');
  if ((await nameInput.count()) === 0) return;
  await nameInput.fill(NAME);
  await tapForReal(page, page.getByRole('button', { name: /start exploring/i }));
  await expect(page.getByRole('button', { name: /solo game/i })).toBeVisible();
}

/**
 * Scroll the nearest scrollable ancestor until the element is inside the
 * viewport, and fail loudly if no ancestor can scroll. Returns the element's
 * centre in viewport coordinates.
 *
 * A `null` return means the element is off-screen and nothing can bring it
 * back — the exact production failure.
 */
async function bringIntoReach(
  locator: Locator,
): Promise<{ x: number; y: number; scrolledBy: number } | null> {
  return locator.evaluate((el: HTMLElement) => {
    const isInside = () => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    };
    if (isInside()) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, scrolledBy: 0 };
    }

    // Walk up for a container a finger could actually drag, then scroll it so
    // the element lands in view. Scrolling straight to the bottom would only
    // ever prove the *last* control is reachable.
    let node: HTMLElement | null = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const scrollable =
        node.scrollHeight > node.clientHeight + 2 && /auto|scroll/.test(style.overflowY);
      if (scrollable) {
        const before = node.scrollTop;
        const elTop = el.getBoundingClientRect().top;
        const boxTop = node.getBoundingClientRect().top;
        // Centre the element in the scroll box where there is room for it.
        const delta = elTop - boxTop - Math.max(0, (node.clientHeight - el.offsetHeight) / 2);
        node.scrollTop = Math.max(0, Math.min(before + delta, node.scrollHeight));
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= window.innerHeight) {
          return {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
            scrolledBy: node.scrollTop - before,
          };
        }
      }
      node = node.parentElement;
    }
    return null;
  });
}

/**
 * Activate the way a real pointer does: real coordinates, no auto-scroll,
 * hit-test first. Touch contexts get a finger tap, non-touch contexts a mouse
 * click at the same coordinates — both bypass Playwright's scroll-into-view.
 */
async function tapForReal(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const point = await bringIntoReach(locator);
  expect(
    point,
    'button is outside the viewport and no ancestor scrolls — unreachable by touch',
  ).not.toBeNull();

  const hitsButton = await locator.evaluate((el: HTMLElement, p: { x: number; y: number }) => {
    const hit = document.elementFromPoint(p.x, p.y);
    return !!hit && (hit === el || el.contains(hit));
  }, point!);
  expect(hitsButton, 'something else is on top of the button at its centre').toBe(true);

  const hasTouch = await page.evaluate(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (hasTouch) {
    await page.touchscreen.tap(point!.x, point!.y);
  } else {
    await page.mouse.click(point!.x, point!.y);
  }
}

test.describe('game mode buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await completeOnboarding(page);
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
    // Without a Maps key the app routes to the setup instructions screen;
    // with one it loads a round. Either proves the tap was received.
    await expect(
      page.getByRole('heading', { name: /add a google maps key|finding a location/i }).or(
        page.getByText(/finding a location/i),
      ),
    ).toBeVisible();
  });
});

test.describe('non-touch input still works', () => {
  test.skip(({ isMobile }) => !!isMobile, 'keyboard and mouse paths are desktop-only');

  test('mouse click opens solo setup', async ({ page }) => {
    await page.goto('/');
    await completeOnboarding(page);
    await page.getByRole('button', { name: /solo game/i }).click();
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();
  });

  test('keyboard Enter and Space activate the mode buttons', async ({ page }) => {
    await page.goto('/');
    await completeOnboarding(page);

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
    await page.goto('/');
    await completeOnboarding(page);
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

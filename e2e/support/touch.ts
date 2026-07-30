import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Shared "did a real finger reach this?" helpers.
 *
 * Extracted from the original mode-button regression spec so every later suite
 * asserts interactivity the same, deliberately paranoid way. The rules these
 * encode are the ones that made the iPhone Safari regression reproducible in a
 * test at all — read e2e/README.md before relaxing any of them.
 */

export interface ReachPoint {
  x: number;
  y: number;
  scrolledBy: number;
}

/**
 * Scroll the nearest scrollable ancestor until the element is inside the
 * viewport, and return the element's centre in viewport coordinates.
 *
 * A `null` return means the element is off-screen and nothing can bring it
 * back — the exact production failure. Never uses `scrollIntoView()`, because
 * that succeeds even when no container a finger could drag exists.
 */
export async function bringIntoReach(locator: Locator): Promise<ReachPoint | null> {
  return locator.evaluate((el: HTMLElement) => {
    const inside = () => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    };
    if (inside()) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, scrolledBy: 0 };
    }

    let node: HTMLElement | null = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const scrollable =
        node.scrollHeight > node.clientHeight + 2 && /auto|scroll/.test(style.overflowY);
      if (scrollable) {
        const before = node.scrollTop;
        const elTop = el.getBoundingClientRect().top;
        const boxTop = node.getBoundingClientRect().top;
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
 * What `document.elementFromPoint()` returns at the element's centre, described
 * well enough to name the culprit when something invisible is on top.
 */
export async function hitTestAt(
  locator: Locator,
  point: { x: number; y: number },
): Promise<{ hits: boolean; describe: string }> {
  return locator.evaluate((el: HTMLElement, p: { x: number; y: number }) => {
    const hit = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
    if (!hit) return { hits: false, describe: 'nothing (point is outside the viewport)' };
    const hits = hit === el || el.contains(hit) || hit.contains(el);
    const style = getComputedStyle(hit);
    return {
      hits,
      describe:
        `<${hit.tagName.toLowerCase()} class="${hit.className}"> ` +
        `position=${style.position} z-index=${style.zIndex} ` +
        `pointer-events=${style.pointerEvents} opacity=${style.opacity}`,
    };
  }, point);
}

/**
 * Assert the element is reachable and is genuinely the topmost thing at its own
 * centre. Returns the point, so callers can reuse it for a tap.
 */
export async function expectReachable(locator: Locator, what: string): Promise<ReachPoint> {
  await expect(locator, `${what} is not visible`).toBeVisible();
  const point = await bringIntoReach(locator);
  expect(
    point,
    `${what} is outside the viewport and no ancestor scrolls — unreachable by touch`,
  ).not.toBeNull();

  const hit = await hitTestAt(locator, point!);
  expect(hit.hits, `${what} is covered at its centre by ${hit.describe}`).toBe(true);

  return point!;
}

/** Assert the control is at least 44×44 CSS px, the iOS touch-target floor. */
export async function expectTouchTarget(locator: Locator, what: string): Promise<void> {
  const box = await locator.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(Math.round(box.w), `${what} is narrower than 44px`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.h), `${what} is shorter than 44px`).toBeGreaterThanOrEqual(44);
}

/**
 * Activate the way a real pointer does: real coordinates, no auto-scroll,
 * hit-test first. Touch contexts get a finger tap, non-touch contexts a mouse
 * click at the same coordinates — both bypass Playwright's scroll-into-view.
 */
export async function tapForReal(page: Page, locator: Locator, what = 'control'): Promise<void> {
  const point = await expectReachable(locator, what);
  const hasTouch = await page.evaluate(
    () => 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  );
  if (hasTouch) {
    await page.touchscreen.tap(point.x, point.y);
  } else {
    await page.mouse.click(point.x, point.y);
  }
}

/**
 * Audit every fixed/absolute full-bleed layer on the page for one that would
 * silently swallow taps: covering most of the viewport, still hit-testable,
 * and not something the user opened on purpose.
 *
 * This is the class of bug the P0 gate is really about — an invisible overlay
 * (a stale loading layer, a banner with the wrong z-index) that leaves every
 * button visible but dead.
 */
export async function findBlockingOverlays(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const offenders: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      if (style.pointerEvents === 'none') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const coversMost = r.width >= vw * 0.9 && r.height >= vh * 0.9 && r.top <= 1 && r.left <= 1;
      if (!coversMost) continue;
      // A layer that covers the screen is only acceptable if it is also the
      // thing the player is looking at (a screen, a dialog) — i.e. it contains
      // focusable controls of its own.
      const interactive = el.querySelector('button, a[href], input, select, textarea, [tabindex]');
      if (interactive) continue;
      offenders.push(
        `<${el.tagName.toLowerCase()} class="${el.className}"> ` +
          `opacity=${style.opacity} z-index=${style.zIndex}`,
      );
    }
    return offenders;
  });
}

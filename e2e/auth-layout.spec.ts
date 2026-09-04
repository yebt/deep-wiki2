import { expect, test, type Page } from '@playwright/test';

/**
 * Layout regressions on the authentication chrome (`AuthShell.vue`).
 *
 * These exist because the defects they guard were invisible to every
 * other test in this repository: the pages rendered, every accessible
 * name was right, and all twelve behavioural e2e passed — while every
 * auth screen carried 49px of permanent vertical scroll at 1280x900 and
 * 121px at 320x900, because `UMain`'s own base height is the viewport
 * minus the *header* with no allowance for the footer. A screen can be
 * functionally correct and still be broken (docs/UI-CHECKLIST.md §6,
 * "the page body never scrolls horizontally" and its observable-breakage
 * list). Assertions here are measurements of the rendered box, which is
 * the only thing that can catch this class.
 */

/** Same hydration wait as e2e/auth.spec.ts — see its `goto` for why
 *  network idle alone is not enough against the dev server. */
async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
}

const AUTH_PAGES = [
  { name: 'sign-in', path: '/login' },
  { name: 'password reset request', path: '/forgot-password' },
  { name: 'password reset confirm', path: '/reset-password?token=layout-probe' },
  { name: 'invitation accept', path: '/invite/accept?token=layout-probe' },
] as const;

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 320, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const { name, path } of AUTH_PAGES) {
      test(`${name} fits the viewport exactly, with the footer on screen`, async ({ page }) => {
        await goto(page, path);

        const box = await page.evaluate(() => ({
          scrollHeight: document.body.scrollHeight,
          innerHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          footerBottom: Math.round(document.querySelector('footer')!.getBoundingClientRect().bottom),
        }));

        // No vertical overflow: these forms fit several times over, so any
        // difference is chrome sized against the wrong box.
        expect(box.scrollHeight).toBe(box.innerHeight);
        // No horizontal body scroll at any breakpoint (§6, verified at 320px).
        expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);
        // The footer ends on screen rather than below the fold.
        expect(box.footerBottom).toBeLessThanOrEqual(box.innerHeight);
      });
    }
  });
}

test.describe('320x900', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('the footer stacks brand-first when it wraps', async ({ page }) => {
    await goto(page, '/login');

    const brand = await page.getByRole('contentinfo').getByText('deep-wiki').boundingBox();
    const meta = await page.getByRole('contentinfo').getByText(/Material Design 3/).boundingBox();

    expect(brand).not.toBeNull();
    expect(meta).not.toBeNull();
    expect(brand!.y).toBeLessThan(meta!.y);
  });
});

test.describe('1280x900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the sign-in block is centred in the space between header and footer', async ({ page }) => {
    await goto(page, '/login');

    const region = await page.evaluate(() => {
      const main = document.querySelector('main')!.getBoundingClientRect();
      const heading = document.querySelector('main h1')!.getBoundingClientRect();
      // The heading and the card are one block; measure from the heading's
      // top to the card's bottom.
      const card = document.querySelector('main h1')!.parentElement!.getBoundingClientRect();
      return {
        gapAbove: heading.top - main.top,
        gapBelow: main.bottom - card.bottom,
      };
    });

    // Symmetric to within a pixel of rounding — not top-aligned with the
    // whole of the free space dumped underneath it.
    expect(Math.abs(region.gapAbove - region.gapBelow)).toBeLessThanOrEqual(2);
  });
});

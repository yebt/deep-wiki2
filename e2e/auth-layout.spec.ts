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
      const main = document.querySelector('main')!;
      const heading = main.querySelector('h1')!;

      // The block is the shell's content column — the one element holding
      // both the heading and the card. It is found by walking *up* from
      // the heading to `main`'s grandchild, rather than by naming the
      // heading's parent: on 2026-09-04 those were the same element, and
      // extracting `PageHeading` later put a wrapper between them. After
      // that, `h1.parentElement` was the heading alone, so the symmetry
      // check below compared the space above the block with the space
      // below the *heading* and reported 436px — the card's height plus
      // the 32px under it — on a screen measured centred to the pixel.
      // Anchoring on `main` is the part that cannot drift; whatever the
      // screen nests inside the column is free to change.
      let block: HTMLElement = heading;
      while (block.parentElement && block.parentElement.parentElement !== main) {
        block = block.parentElement;
      }

      const mainBox = main.getBoundingClientRect();
      const headingBox = heading.getBoundingClientRect();
      const blockBox = block.getBoundingClientRect();
      return {
        gapAbove: headingBox.top - mainBox.top,
        gapBelow: mainBox.bottom - blockBox.bottom,
        headingHeight: headingBox.height,
        blockHeight: blockBox.height,
      };
    });

    // The block is the heading *and* the card, so it is taller than the
    // heading on its own. This is the guard the previous version lacked:
    // without it the measurement can silently narrow back to the heading,
    // and the assertion below stops being about centring at all.
    expect(region.blockHeight).toBeGreaterThan(region.headingHeight);

    // Symmetric to within a pixel of rounding — not top-aligned with the
    // whole of the free space dumped underneath it.
    expect(Math.abs(region.gapAbove - region.gapBelow)).toBeLessThanOrEqual(2);
  });
});

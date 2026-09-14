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

/**
 * Pointer targets are at least 24x24 CSS px (docs/UI-CHECKLIST.md §5).
 * The auth screens' text links — "Forgot your password?", "Back to sign
 * in", "Continue to sign in" — measured **19px** tall on 2026-09-14: a
 * bare `label-large` line box. The fix is the box, not the type, so this
 * measures the rendered box on every link inside the content region,
 * across every state that has one. happy-dom has no layout engine, so
 * this file is the owner of that guarantee.
 */
test.describe('link targets', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const { name, path } of AUTH_PAGES) {
    test(`${name}: every link in the content region is at least 24px tall`, async ({ page }) => {
      await goto(page, path);

      // The invitation form with a live token has no link at all — its way
      // forward is the form — so the count is not asserted here; the
      // no-token test below is where a way out is the point.
      const links = page.locator('main a');
      for (const link of await links.all()) {
        const box = await link.boundingBox();
        expect(box, await link.textContent()).not.toBeNull();
        expect(box!.height, `"${(await link.textContent())?.trim()}" is ${box!.height}px tall`).toBeGreaterThanOrEqual(24);
        expect(box!.width).toBeGreaterThanOrEqual(24);
      }
    });
  }

  test('the no-token reset and invite states each keep a way out, and it is a 24px target', async ({ page }) => {
    for (const path of ['/reset-password', '/invite/accept']) {
      await goto(page, path);
      const exits = page.locator('main a');
      expect(await exits.count(), path).toBeGreaterThan(0);
      for (const exit of await exits.all()) {
        const box = await exit.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(24);
      }
    }
  });
});


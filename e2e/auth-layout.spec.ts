import { expect, test, type Page } from '@playwright/test';
import { boundaryContrast } from './contrast';

/**
 * Layout and contrast regressions on the sign-in family's shell
 * (`AuthShell.vue`).
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
 *
 * Since 2026-09-15 the shell draws no app chrome at all — no header, no
 * footer — so the trap that produced the first measurement cannot recur
 * in the same shape. The measurement stays, because the next shape will
 * be different and the box is still the only thing that catches it.
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

/**
 * Nuxt's colour mode is class-driven (`.dark` on `<html>`, docs/DESIGN-SYSTEM.md
 * §0) and persisted under `nuxt-color-mode`; setting it before hydration
 * is what the toggle does, without a round trip through the UI.
 */
async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
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

const THEMES = ['light', 'dark'] as const;

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${viewport.width}x${viewport.height} ${theme}`, () => {
      test.use({ viewport });

      for (const { name, path } of AUTH_PAGES) {
        test(`${name} fits the viewport exactly, with no app chrome around it`, async ({ page }) => {
          await useTheme(page, theme);
          await goto(page, path);
          await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

          const box = await page.evaluate(() => ({
            scrollHeight: document.body.scrollHeight,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            headers: document.querySelectorAll('header').length,
            footers: document.querySelectorAll('footer').length,
          }));

          // No vertical overflow: these forms fit several times over, so any
          // difference is chrome sized against the wrong box.
          expect(box.scrollHeight).toBe(box.innerHeight);
          // No horizontal body scroll at any breakpoint (§6, verified at 320px).
          expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);
          // A sign-in is met before the product: the app's landmarks are absent.
          expect(box.headers).toBe(0);
          expect(box.footers).toBe(0);
        });
      }
    });
  }
}

test.describe('320x900', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('the theme toggle and the product’s mark do not collide at the narrowest width', async ({ page }) => {
    await goto(page, '/login');

    const toggle = await page.getByRole('button', { name: /theme|dark|light/i }).boundingBox();
    const mark = await page.getByText('deep-wiki', { exact: true }).boundingBox();

    expect(toggle).not.toBeNull();
    expect(mark).not.toBeNull();
    const overlaps =
      toggle!.x < mark!.x + mark!.width &&
      mark!.x < toggle!.x + toggle!.width &&
      toggle!.y < mark!.y + mark!.height &&
      mark!.y < toggle!.y + toggle!.height;
    expect(overlaps, 'the toggle sits on top of the mark').toBe(false);
  });
});

test.describe('1280x900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the sign-in block is centred in the viewport', async ({ page }) => {
    await goto(page, '/login');

    const region = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const heading = main.querySelector('h1')!;

      // The block is the shell's content column — the one element holding
      // the mark, the heading and the card. It is found by walking *up*
      // from the heading to `main`'s grandchild, rather than by naming the
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
        gapAbove: blockBox.top - mainBox.top,
        gapBelow: mainBox.bottom - blockBox.bottom,
        headingHeight: headingBox.height,
        blockHeight: blockBox.height,
        headingTop: headingBox.top,
        blockTop: blockBox.top,
      };
    });

    // The block is the mark, the heading *and* the card, so it is taller
    // than the heading on its own. This is the guard the previous version
    // lacked: without it the measurement can silently narrow back to the
    // heading, and the assertion below stops being about centring at all.
    expect(region.blockHeight).toBeGreaterThan(region.headingHeight);
    // And the heading is not the top of the block: the mark stands above it.
    expect(region.headingTop).toBeGreaterThan(region.blockTop);

    // Symmetric to within a pixel of rounding — not top-aligned with the
    // whole of the free space dumped underneath it.
    expect(Math.abs(region.gapAbove - region.gapBelow)).toBeLessThanOrEqual(2);
  });

  test('the mark, the heading block and the card sit on one 32px rhythm', async ({ page }) => {
    await goto(page, '/login');

    const gaps = await page.evaluate(() => {
      const heading = document.querySelector('main h1')!;
      const headingBlock = heading.parentElement!;
      const mark = headingBlock.previousElementSibling!;
      const card = headingBlock.nextElementSibling!;
      return {
        markToHeading: headingBlock.getBoundingClientRect().top - mark.getBoundingClientRect().bottom,
        headingToCard: card.getBoundingClientRect().top - headingBlock.getBoundingClientRect().bottom,
      };
    });

    // docs/DESIGN-SYSTEM.md §7.4: 32px from the heading block to the container
    // below it; the mark keeps the same distance above, so the column reads as
    // three objects on one rhythm rather than a lockup stuck to a heading.
    expect(gaps.markToHeading).toBe(32);
    expect(gaps.headingToCard).toBe(32);
  });

  test('the theme toggle is the one control outside the card, it is a 24px target, and it switches the theme', async ({ page }) => {
    await goto(page, '/login');

    const toggle = page.getByRole('button', { name: /theme|dark|light/i });
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);

    const before = await page.locator('html').getAttribute('class');
    await toggle.click();
    await expect(page.locator('html')).not.toHaveClass(before ?? '');
  });
});

/**
 * Contrast is computed in the running browser, never assumed from a token
 * name: the dark auth card once measured 1.14:1 against the page ground
 * because an M3 tone had been written as an oklch percentage (2026-09-04
 * review). The checklist fixes 4.5:1 for text and 3:1 for the boundary of
 * an interactive control (§5), in every theme; the container step has no
 * checklist number, so its floor here is the tone step §9.4 rules — tone
 * 98 against 90 in light is 1.23:1, tone 10 against 24 in dark is 1.48:1 —
 * pinned just below the smaller of the two, so a collapsed rung fails.
 */
async function textContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const toRgba = (css: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const foreground = toRgba(getComputedStyle(element).color);
    let ground: [number, number, number, number] | null = null;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const candidate = toRgba(getComputedStyle(node).backgroundColor);
      if (candidate[3] > 0) {
        ground = candidate;
        break;
      }
    }
    if (!ground) ground = toRgba(getComputedStyle(document.body).backgroundColor);
    const lighter = Math.max(luminance(foreground), luminance(ground));
    const darker = Math.min(luminance(foreground), luminance(ground));
    return (lighter + 0.05) / (darker + 0.05);
  });
}

for (const theme of THEMES) {
  test.describe(`contrast, ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test(`every text role on the sign-in screen clears 4.5:1 and every control boundary clears 3:1`, async ({ page }) => {
      await useTheme(page, theme);
      await goto(page, '/login');
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

      const measured = {
        // `:last-child`, not the first span: `UIcon` renders as a span whose
        // background is `currentColor` (a mask), which measures 1:1 by construction.
        wordmark: await textContrast(page, 'main p span:last-child'),
        heading: await textContrast(page, 'main h1'),
        description: await textContrast(page, 'main h1 + p'),
        formNote: await textContrast(page, '[data-slot="description"]'),
        label: await textContrast(page, 'label'),
        input: await textContrast(page, 'input[type="email"]'),
        link: await textContrast(page, 'main a'),
        submitLabel: await textContrast(page, 'button[type="submit"]'),
        card: await boundaryContrast(page.locator('main h1').locator('xpath=../following-sibling::*[1]')),
        inputBoundary: await boundaryContrast(page.locator('input[type="email"]')),
        submitBoundary: await boundaryContrast(page.locator('button[type="submit"]')),
      };
      // Printed so the review can quote the numbers rather than the floors.
      console.log(`[auth contrast ${theme}]`, JSON.stringify(measured));

      for (const [role, ratio] of Object.entries(measured)) {
        if (role === 'card') expect(ratio, `${role} ${theme}`).toBeGreaterThanOrEqual(1.2);
        else if (role.endsWith('Boundary')) expect(ratio, `${role} ${theme}`).toBeGreaterThanOrEqual(3);
        else expect(ratio, `${role} ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}

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

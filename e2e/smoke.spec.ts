import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './overflow';

/**
 * The front door boots, is themed, and lands a stranger on the sign-in
 * screen — and on nothing else.
 *
 * This suite used to drive the Phase 0 smoke page that lived at `/`, then
 * the workspace list `/` redirected to. Since the owner's 2026-09-16 review
 * (`feat/frame-review-shell`) a signed-out visit to `/` goes `/` →
 * `/workspaces` → `/login?next=/workspaces`, and the sign-in screen is
 * `AuthShell`'s own composition: the product's mark, one `h1`, one card,
 * the theme toggle — and deliberately **no app chrome**, because a person
 * who has not signed in is not inside the product yet (that shell's own
 * comment, and docs/DESIGN-SYSTEM.md §14, 2026-09-15). So the landmark
 * assertions this suite used to make — a `banner`, a `contentinfo` — are
 * now the assertions that must *fail*: an app bar on the sign-in screen
 * would mean the app chrome leaked onto a screen shown to a stranger.
 * The redirect itself, and the way back after signing in, are
 * e2e/navigation.spec.ts's; the auth screens' geometry at both viewports
 * is e2e/auth-layout.spec.ts's. What this file proves is the boot: the
 * dev server answers, the app hydrates, the redirect chain lands on a
 * real screen, and the theme switch changes what is actually painted.
 *
 * Assertions target accessible roles/names and observable visual state,
 * never CSS classes or test IDs (docs/UI-CHECKLIST.md §7).
 */

/** Review material, written only when asked for (the frame batch's `DEEPWIKI_FRAME_SHOTS` convention). */
const SHOTS = process.env.DEEPWIKI_FIX2_SHOTS ?? '';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-fix2-${name}.png`, fullPage: false });
}

/**
 * The toggle is server-rendered and visible before Vue has attached its
 * listener, and a click in that window reaches nothing (observed flakiness
 * without this in the suite's first version). Network idle is not enough
 * on the dev server — Vite's many small requests reach idle with hydration
 * still pending — so Nuxt's own signal is waited for, as
 * e2e/navigation.spec.ts does before touching a form.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
}

/** What the page ground is painted — the app ground `body` carries (docs/DESIGN-SYSTEM.md §8.3). */
async function groundColor(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function landOnSignIn(page: Page): Promise<void> {
  await page.goto('/');

  // `/` is an alias for the workspace list, which sends a stranger to sign
  // in with the list as the way back (e2e/navigation.spec.ts drives the
  // return trip; here the destination is what matters).
  await expect(page).toHaveURL(/\/login\?next=/, { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get('next')).toBe('/workspaces');
  await expect(page.getByRole('heading', { level: 1, name: /^sign in$/i })).toBeVisible();
}

test('the front door boots, is themed, and lands a signed-out visitor on the sign-in screen with no app chrome', async ({ page }) => {
  await landOnSignIn(page);

  // A real screen: the sign-in form, in the one `main` landmark.
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  const signIn = page.getByRole('button', { name: /^sign in$/i });
  await expect(signIn).toBeVisible();

  // And nothing of the signed-in product: no app bar, no footer, no
  // navigation, no link back to a room the visitor is not in — the mark
  // is text, not a link. The theme toggle is the only control on the
  // screen outside the card.
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /deep-wiki/i })).toHaveCount(0);
  await expect(page.getByText('deep-wiki', { exact: true })).toBeVisible();

  const themeToggle = page.getByRole('button', { name: /toggle color theme/i });
  await expect(themeToggle).toBeVisible();

  // Themed: the toggle changes the colour the page ground is actually
  // painted — a rendered property tied to the app ground, not a class
  // name lookup — and the one Filled button moves with it (`primary` is
  // tone 40 light / tone 70 dark, docs/DESIGN-SYSTEM.md §14), so both
  // tone tables are really loaded, not one of them plus an inverted class.
  await waitForHydration(page);
  await shot(page, 'front-door-1280-light');
  const buttonColor = () => signIn.evaluate((el) => getComputedStyle(el).backgroundColor);
  const groundBefore = await groundColor(page);
  const buttonBefore = await buttonColor();
  expect(groundBefore).not.toBe(buttonBefore);

  await themeToggle.click();
  await expect.poll(() => groundColor(page)).not.toBe(groundBefore);
  await expect.poll(buttonColor).not.toBe(buttonBefore);
  await shot(page, 'front-door-1280-dark');
});

test.describe('the front door on a phone', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('lands on the same sign-in screen with nothing scrolling sideways', async ({ page }) => {
    await landOnSignIn(page);

    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /toggle color theme/i })).toBeVisible();

    await waitForHydration(page);
    await expectNoHorizontalOverflow(page, 'the front door at 320');
    await shot(page, 'front-door-320-light');
  });
});

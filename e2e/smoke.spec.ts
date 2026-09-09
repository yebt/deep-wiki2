import { expect, test } from '@playwright/test';

/**
 * The front door boots, carries the shell's landmarks, and is themed.
 *
 * This suite used to drive the Phase 0 smoke page that lived at `/` — a
 * grid of panels whose own copy said "there is no navigation tree, no
 * editor and no sign-in" long after all three existed. `/` is now a
 * redirect to the workspace list, so the journey starts the same way and
 * lands on a real screen; the two assertions that were about the smoke
 * page's health panel are gone, and what they were evidence for — that the
 * browser really reaches `apps/api` — is now carried by
 * e2e/navigation.spec.ts, which drives a live, permission-filtered list
 * rather than a status dot.
 *
 * Assertions target accessible roles/names and observable visual state,
 * never CSS classes or test IDs (docs/UI-CHECKLIST.md §7).
 */
test('the front door boots, is themed, and lands on a real screen', async ({ page }) => {
  await page.goto('/');

  // `/` is an alias for the workspace list, not a screen of its own.
  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();

  const themeToggle = page.getByRole('button', { name: /toggle color theme/i });
  await expect(themeToggle).toBeVisible();

  // Assert the header landmark's actual rendered background color changes
  // — a genuine visual property tied to a semantic role, not a CSS class
  // name lookup. Waiting for network idle first avoids clicking before
  // client hydration attaches the toggle's handler (observed flakiness
  // without it).
  await page.waitForLoadState('networkidle');
  const header = page.getByRole('banner');
  const headerBackgroundBefore = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
  await themeToggle.click();
  await expect
    .poll(() => header.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(headerBackgroundBefore);
});

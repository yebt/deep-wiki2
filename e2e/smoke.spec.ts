import { expect, test } from '@playwright/test';

/**
 * Phase 0 smoke journey: the app boots, renders its one screen with the
 * expected landmarks, is themed (a real, user-visible change on toggle),
 * and reports live API connectivity — not a product feature (see
 * apps/web/app/pages/index.vue and docs/UI-CHECKLIST.md's scope note).
 *
 * Assertions target accessible roles/names and observable visual state,
 * never CSS classes or test IDs (see docs/UI-CHECKLIST.md §7 rules).
 */
test('boots, is themed, and reports API connectivity', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Bootstrap smoke page' })).toBeVisible();
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

  const status = page.getByRole('status');
  await expect(status).toBeVisible();
  // The health check fires automatically on mount; whatever the outcome
  // (apps/api may or may not be running alongside this e2e run), it must
  // settle away from its initial placeholder — proving the real network
  // call actually happened, not just that the composable was wired up.
  await expect(status).not.toHaveText('Not checked yet');

  const retry = page.getByRole('button', { name: /re-check api connection/i });
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
});

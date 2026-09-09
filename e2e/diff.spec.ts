import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * Page-level diff (block-diff spec: "Diff Reports Added, Removed,
 * Modified, And Moved"; docs/UI-CHECKLIST.md §4.7). Against the same
 * seeded `historyPageId` e2e/history.spec.ts uses — two real saves, the
 * second one both changing the existing paragraph and adding a new one,
 * so this suite's happy path exercises two distinct classifications from
 * one real diff rather than one block repeated twice.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly historyPageId: string;
  readonly historyFirstRevisionId: string;
  readonly historySecondRevisionId: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

test.describe.configure({ mode: 'serial' });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

/**
 * Navigates by clicking from the history screen, deliberately never by
 * typing the diff URL: a URL-driven test would still pass with the
 * "Compare with previous" control deleted from history.vue, which is
 * exactly the wiring this test exists to prove (task 10.3).
 */
test('a reader reaches the diff by clicking from history, and sees the added and modified blocks distinctly', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}/history`);
  await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeVisible();

  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30000 });

  const compare = rows.nth(0).getByRole('link', { name: /compare with previous/i });
  await expect(compare).toBeVisible();
  await compare.click();

  // Generous timeout on THIS assertion specifically, not the heading below
  // it: `/diff` is a route the dev server has never compiled before this
  // click, and the on-demand compile can outlast Playwright's 5s default
  // under load — the same class of flakiness e2e/history.spec.ts already
  // documents and fixes the same way.
  await expect(page).toHaveURL(
    `/pages/${fixtures.historyPageId}/diff?from=${fixtures.historyFirstRevisionId}&to=${fixtures.historySecondRevisionId}`,
    { timeout: 30000 },
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Page diff' })).toBeVisible();

  // The added block (new second-save paragraph) and the modified block
  // (the changed first paragraph) both appear, each under its own
  // distinct label — not merged into one classification.
  await expect(page.getByText('A paragraph that did not exist in the first version.')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Added', { exact: true })).toBeVisible();
  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
});

/**
 * An outsider cannot reach the history screen at all (it 404s for them —
 * e2e/history.spec.ts already holds that), so there is no click path onto
 * this screen to prove ITS OWN non-disclosure guard. This is the one
 * place in this suite that navigates by address, because it is the only
 * way to exercise the diff route's own `can('read')` gate independently
 * of history's.
 */
test('an outsider with no read grant sees the same not-found state a nonexistent diff would render', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(
    `/pages/${fixtures.historyPageId}/diff?from=${fixtures.historyFirstRevisionId}&to=${fixtures.historySecondRevisionId}`,
  );
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });

  const deniedHtml = await page.content();
  expect(deniedHtml).not.toContain('did not exist in the first version');
  expect(deniedHtml).not.toContain('E2E Owner');

  await page.goto(
    `/pages/${crypto.randomUUID()}/diff?from=${fixtures.historyFirstRevisionId}&to=${fixtures.historySecondRevisionId}`,
  );
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });
});

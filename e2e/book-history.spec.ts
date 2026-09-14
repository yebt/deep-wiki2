import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * Book-level changeset history and book diff (changesets spec: "Book-Level
 * History Is One Query"; block-diff spec: "Book-Level Diff Aggregates
 * Changed Pages Since A Date"; docs/UI-CHECKLIST.md §4.7: "Book-level
 * (changeset) diff is navigable: the user can move between changed pages
 * without returning to a list"; task 10.5).
 *
 * Against `e2e/seed.bun.ts`'s book fixture: a shelf > book > two pages
 * structure with TWO changesets by the same author — a single changeset
 * would exercise no grouping at all (this is exactly the trap tasks.md
 * 10.5 names). The happy path below reaches the history screen from the
 * navigation tree, and the diff screen from the history screen, entirely
 * by clicking — the ONE address this suite types is the tree's own URL,
 * the same convention e2e/navigation.spec.ts and e2e/history.spec.ts use
 * for their own single entry point.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly workspaceId: string;
  readonly bookHistoryBookId: string;
  readonly bookHistoryBookTitle: string;
  readonly bookHistoryPageAId: string;
  readonly bookHistoryPageBId: string;
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

test('a reader reaches book history from the tree, and book diff from history, entirely by clicking — and Next/Previous show each page\'s own content', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.readerSessionToken);

  // The one and only address this test types.
  await page.goto(`/workspaces/${fixtures.workspaceId}/tree`, { timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Navigation tree' })).toBeVisible({ timeout: 30000 });

  // Click 1 — the header affordance task 10.5 added to this screen. The
  // tree's own data is fetched client-side after mount (`useTree`, like
  // every other list screen in this suite), so the row/link only exists
  // once that fetch resolves — the generous timeout belongs on this wait,
  // not on the `goto` above, per e2e/history.spec.ts's identical note.
  const bookHistoryLink = page.getByRole('link', { name: fixtures.bookHistoryBookTitle });
  await expect(bookHistoryLink).toBeVisible({ timeout: 30000 });
  await bookHistoryLink.click();

  await expect(page).toHaveURL(`/books/${fixtures.bookHistoryBookId}/history`, { timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Book history' })).toBeVisible({ timeout: 30000 });

  // Grouping is real: two changesets, not one flattened list of saves —
  // the trap this fixture exists to not-trivially pass.
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30000 });
  // The newest changeset (row 0) grouped both pages together.
  await expect(rows.nth(0)).toContainText('2 pages changed');

  // Click 2 — "View diff since here" on the newest changeset, which is
  // exactly the boundary between the two changesets: everything in
  // changeset 2 (both pages) is what this diff shows.
  const diffLink = rows.nth(0).getByRole('link', { name: /view diff since here/i });
  await expect(diffLink).toBeVisible({ timeout: 30000 });
  await diffLink.click();

  await expect(page).toHaveURL(new RegExp(`^.*/books/${fixtures.bookHistoryBookId}/diff\\?since=`), { timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Book diff' })).toBeVisible({ timeout: 30000 });

  // Two pages changed; the switcher says so, and the first page's own
  // content is what's showing.
  await expect(page.getByText(/page 1 of 2/i)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('pineapples', { exact: false })).toBeVisible();
  await expect(page.getByText('Added', { exact: true })).toBeVisible();
  await expect(page.getByText('Moved down', { exact: true })).toBeVisible();

  // The trap named explicitly in tasks.md 10.5: a test that only checks
  // the FIRST page proves nothing about navigation. Click "Next" and
  // assert the SECOND page's own, different content replaces it.
  const nextButton = page.getByRole('button', { name: 'Next changed page' });
  await expect(nextButton).toBeVisible();
  await nextButton.click();

  await expect(page.getByText(/page 2 of 2/i)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Book page beta', { exact: false })).toBeVisible();
  await expect(page.getByText('pineapples', { exact: false })).toHaveCount(0);

  // "Previous" restores the first page's own content.
  const prevButton = page.getByRole('button', { name: 'Previous changed page' });
  await prevButton.click();

  await expect(page.getByText(/page 1 of 2/i)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('pineapples', { exact: false })).toBeVisible();
});

test('an outsider with no read grant sees the same not-found state a nonexistent book would render, for both screens', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(`/books/${fixtures.bookHistoryBookId}/history`);
  await expect(page.getByRole('heading', { name: 'This book does not exist' })).toBeVisible({ timeout: 30000 });
  const deniedHistoryHtml = await page.content();
  expect(deniedHistoryHtml).not.toContain(fixtures.bookHistoryBookTitle);
  expect(deniedHistoryHtml).not.toContain('E2E Owner');

  await page.goto(`/books/${crypto.randomUUID()}/history`);
  await expect(page.getByRole('heading', { name: 'This book does not exist' })).toBeVisible({ timeout: 30000 });

  await page.goto(`/books/${fixtures.bookHistoryBookId}/diff?since=2026-01-01T00%3A00%3A00.000Z`);
  await expect(page.getByRole('heading', { name: 'This book does not exist' })).toBeVisible({ timeout: 30000 });
});

// The genuinely empty (a real book, zero changesets) state has no
// dedicated fixture in this seed — adding one would mean a third book
// solely for this case. It is fully covered, and fully controllable, at
// the unit level in `apps/web/app/pages/books/[id]/history.test.ts`
// instead; this suite covers the states a fixture makes reachable
// end-to-end.

test('a broken book-diff link with no `since` renders a real explanation, not a server error', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/books/${fixtures.bookHistoryBookId}/diff`);

  await expect(page.getByRole('heading', { name: /missing its date/i })).toBeVisible({ timeout: 30000 });
});

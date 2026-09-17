import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';
import {
  bookDiffUrl,
  bookHistoryUrl,
  membersUrl,
  pageDiffUrl,
  pageEditUrl,
  pageHistoryUrl,
  pageUrl,
  workspaceUrl,
} from '../apps/web/app/utils/routes';

/**
 * The addresses every link had before 2026-09-17 still land. A bookmark to
 * `/pages/<id>`, a mail with `/books/<id>/history` in it, a pasted
 * `/workspaces/<id>` — each is answered by the server itself with a `301`
 * to the new shape (`/w/<slug>/…`, apps/web/app/utils/routes.ts), the
 * query kept, and by the browser with the screen the new address renders.
 *
 * And what it must not become: an oracle. A page the caller may not read
 * and a page that never existed bounce to the same not-found screen, and
 * nothing in either answer says which it was.
 */

interface Fixtures {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly readPageId: string;
  readonly historyPageId: string;
  readonly historyFirstRevisionId: string;
  readonly historySecondRevisionId: string;
  readonly bookHistoryBookId: string;
  readonly bookDiffSinceIso: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

const slug = () => fixtures.workspaceSlug;

/** Every old shape and the address it now lives at. */
const MOVES: readonly { readonly from: string; readonly to: string }[] = [
  { from: `/pages/${fixtures.readPageId}`, to: pageUrl(slug(), fixtures.readPageId) },
  { from: `/pages/${fixtures.readPageId}/edit`, to: pageEditUrl(slug(), fixtures.readPageId) },
  { from: `/pages/${fixtures.historyPageId}/history`, to: pageHistoryUrl(slug(), fixtures.historyPageId) },
  {
    from: `/pages/${fixtures.historyPageId}/diff?from=${fixtures.historyFirstRevisionId}&to=${fixtures.historySecondRevisionId}`,
    to: pageDiffUrl(slug(), fixtures.historyPageId, { from: fixtures.historyFirstRevisionId, to: fixtures.historySecondRevisionId }),
  },
  { from: `/books/${fixtures.bookHistoryBookId}/history`, to: bookHistoryUrl(slug(), fixtures.bookHistoryBookId) },
  {
    from: `/books/${fixtures.bookHistoryBookId}/diff?since=${encodeURIComponent(fixtures.bookDiffSinceIso)}`,
    to: bookDiffUrl(slug(), fixtures.bookHistoryBookId, { since: fixtures.bookDiffSinceIso }),
  },
  { from: `/workspaces/${fixtures.workspaceId}`, to: workspaceUrl(slug()) },
  { from: `/workspaces/${fixtures.workspaceId}/members`, to: membersUrl(slug()) },
];

/** An address as a path and its query's entries — the router re-encodes a query on the way through, so bytes are not the comparison. */
function shape(address: string): { path: string; query: [string, string][] } {
  const url = new URL(address, 'http://localhost');
  return { path: url.pathname, query: [...url.searchParams.entries()] };
}

test('the server answers every old address with a 301 to the new one, query kept', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  for (const move of MOVES) {
    const response = await page.request.get(move.from, { maxRedirects: 0 });
    expect(response.status(), move.from).toBe(301);
    expect(shape(response.headers()['location'] ?? ''), move.from).toEqual(shape(move.to));
  }
});

test('an old page address lands on the page, at its new address', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.readPageId}`);

  await expect(page).toHaveURL(new RegExp(`${pageUrl(slug(), fixtures.readPageId)}$`), { timeout: 30000 });
  await expect(page.locator('article')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('an old book history address lands on the book history, and the old workspace address on the dashboard', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/books/${fixtures.bookHistoryBookId}/history`);
  await expect(page).toHaveURL(new RegExp(`${bookHistoryUrl(slug(), fixtures.bookHistoryBookId)}$`), { timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });

  await page.goto(`/workspaces/${fixtures.workspaceId}`);
  await expect(page).toHaveURL(new RegExp(`${workspaceUrl(slug())}$`), { timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });
});

test('a page the caller may not read and a page that does not exist bounce to the same not-found screen', async ({ page, context }) => {
  // The outsider holds nothing anywhere: the seeded page exists and is
  // denied; the random id never existed.
  await signInAs(context, fixtures.outsiderSessionToken);

  const denied = await page.request.get(`/pages/${fixtures.readPageId}`, { maxRedirects: 0 });
  const absent = await page.request.get(`/pages/${crypto.randomUUID()}`, { maxRedirects: 0 });
  expect(denied.status()).toBe(404);
  expect(absent.status()).toBe(404);
  expect(denied.headers()['location']).toBeUndefined();

  await page.goto(`/pages/${fixtures.readPageId}`);
  await expect(page.getByRole('heading', { level: 1, name: "This link doesn't lead anywhere" })).toBeVisible({ timeout: 30000 });
  // The address stays the old one: nothing about where the page lives has been said.
  await expect(page).toHaveURL(new RegExp(`/pages/${fixtures.readPageId}$`));
  await expect(page.getByRole('button', { name: 'Your workspaces' })).toBeVisible();
});

test('signed out, an old address leads to sign-in with itself as the way back', async ({ page }) => {
  await page.goto(`/pages/${fixtures.readPageId}/edit`);

  await expect(page).toHaveURL(/\/login\?next=/, { timeout: 30000 });
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/pages/${fixtures.readPageId}/edit`);
});

test('an address whose workspace slug is not the page’s is not found, without saying which half was wrong', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(pageUrl('never-minted-workspace', fixtures.readPageId));

  const notice = page.getByTestId('scope-not-found');
  await expect(notice).toBeVisible({ timeout: 30000 });
  await expect(notice.getByRole('heading', { level: 1, name: 'There is nothing at this address' })).toBeVisible();
  await expect(notice).toContainText(/deliberately doesn't say which/);
  // The page's own surfaces are withheld with it: no Edit, no history.
  await expect(page.locator('#content-bar').getByRole('link', { name: 'Edit' })).toHaveCount(0);
  // The sidebar does not stand on the page's real workspace: no row for
  // the page, nothing marked current — the address named a workspace the
  // caller cannot open, and that is what the frame shows.
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  await expect(sidebar.locator(`a[href*="${fixtures.readPageId}"]`)).toHaveCount(0);
  await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(0);
  await expect(sidebar.getByTestId('sidebar-no-workspace')).toBeVisible();
});

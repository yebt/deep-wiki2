import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { bookDiffUrl, bookHistoryUrl, workspaceUrl } from '../apps/web/app/utils/routes';

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
  readonly workspaceSlug: string;
  readonly bookHistoryBookId: string;
  readonly bookHistoryBookTitle: string;
  readonly bookHistoryPageAId: string;
  readonly bookHistoryPageBId: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

/** e2e/frame.spec.ts's own review-material convention, reused here rather than invented again (docs/UI-CHECKLIST.md §4.1). */
const SHOTS = process.env.DEEPWIKI_BOOK_SHOTS ?? '';

test.describe.configure({ mode: 'serial' });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/frame3-book-${name}.png`, fullPage: false });
}

test('a reader reaches book history from the tree, and book diff from history, entirely by clicking — and Next/Previous show each page\'s own content', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.readerSessionToken);

  // The one and only address this test types.
  await page.goto(workspaceUrl(fixtures.workspaceSlug), { timeout: 30000 });
  await expect(page.getByRole('heading', { level: 1, name: /E2E Workspace/ })).toBeVisible({ timeout: 30000 });

  // Click 1 — the book row's context action in the sidebar's tree: a menu
  // on the row, named for the book, not a chrome link. The tree's own data
  // is fetched client-side after mount, so the row only exists once that
  // fetch resolves — the generous timeout belongs on this wait, not on the
  // `goto` above, per e2e/history.spec.ts's identical note.
  const bookRow = page.getByRole('treeitem', { name: new RegExp(fixtures.bookHistoryBookTitle) });
  await expect(bookRow).toBeVisible({ timeout: 30000 });
  await bookRow.hover();
  await page.getByRole('button', { name: `Actions for ${fixtures.bookHistoryBookTitle}` }).click();
  await page.getByRole('menuitem', { name: 'Book history' }).click();

  await expect(page).toHaveURL(bookHistoryUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId), { timeout: 30000 });
  // The screen names the book it is about, not only what kind of screen it
  // is — an `<h1>` for the accessibility tree; the frame's own breadcrumb
  // carries the same name beside it, for sighted readers.
  await expect(page.getByRole('heading', { level: 1, name: `${fixtures.bookHistoryBookTitle} — book history` })).toBeVisible({ timeout: 30000 });
  const crumbs = page.getByRole('navigation', { name: 'Where you are' });
  await expect(crumbs).toContainText(fixtures.bookHistoryBookTitle);
  await expect(crumbs).toContainText('History');

  // Grouping is real: two changesets, not one flattened list of saves —
  // the trap this fixture exists to not-trivially pass.
  const rows = page.getByRole('main').getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30000 });
  // The newest changeset (row 0) grouped both pages together.
  await expect(rows.nth(0)).toContainText('2 pages changed');

  // "Compare since…", in the contextual bar, is the same transition as the
  // newest changeset's own "View diff since here" — reachable without
  // scrolling to the top row.
  await expect(page.getByRole('link', { name: /compare since/i })).toBeVisible({ timeout: 30000 });

  // Click 2 — "View diff since here" on the newest changeset, which is
  // exactly the boundary between the two changesets: everything in
  // changeset 2 (both pages) is what this diff shows.
  const diffLink = rows.nth(0).getByRole('link', { name: /view diff since here/i });
  await expect(diffLink).toBeVisible({ timeout: 30000 });
  await diffLink.click();

  await expect(page).toHaveURL(
    new RegExp(`^.*${bookDiffUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId)}\\?since=`),
    { timeout: 30000 },
  );
  await expect(page.getByRole('heading', { level: 1, name: `${fixtures.bookHistoryBookTitle} — book diff` })).toBeVisible({ timeout: 30000 });
  await expect(crumbs).toContainText(fixtures.bookHistoryBookTitle);
  await expect(crumbs).toContainText('History');
  await expect(crumbs).toContainText(/changes since/i);

  // Two pages changed; the switcher — previous / current page name / next,
  // in the contextual bar so the pane below is the diff alone — names the
  // focused page by its title (the route carries it now — no more eight
  // characters of an id) and its position among the changed pages. The
  // route itself orders changed pages by page id, which the seed mints at
  // random, but the switcher now orders by the pages' own tree position
  // (`useBookDiffNavigator`'s `pageOrder`), and the seed places Alpha
  // before Beta under the book — so which comes first is asserted, not
  // read off the screen the way the previous version of this test had to.
  // Scoped to the contextual bar: since 2026-09-16 every page row in the
  // sidebar's tree is a link named for its page too (`NavigationTreeNode`),
  // so the name alone resolves to the two rows as well as the switcher.
  const focused = page.locator('#content-bar').getByRole('link', { name: /E2E Book Page (Alpha|Beta)/ });
  await expect(focused).toBeVisible({ timeout: 30000 });
  await expect(focused).toHaveText(/E2E Book Page Alpha \(1\/2\)/);

  // What each page's own diff shows and the other's does not: Alpha gained
  // a paragraph and moved one; Beta's one paragraph was edited in place.
  const own = {
    'E2E Book Page Alpha': { text: 'pineapples', badge: 'Moved down' },
    'E2E Book Page Beta': { text: '## Book page beta', badge: 'Modified' },
  } as const;

  await expect(page.getByText(own['E2E Book Page Alpha'].text, { exact: false })).toBeVisible();
  await expect(page.getByText(own['E2E Book Page Alpha'].badge, { exact: true })).toBeVisible();
  await expect(page.getByText(own['E2E Book Page Beta'].text, { exact: false })).toHaveCount(0);

  // The trap named explicitly in tasks.md 10.5: a test that only checks
  // the FIRST page proves nothing about navigation. Click "Next" and
  // assert the SECOND page's own, different content replaces it.
  const nextButton = page.getByRole('button', { name: 'Next changed page' });
  await expect(nextButton).toBeVisible();
  await nextButton.click();

  await expect(page.getByRole('link', { name: /E2E Book Page Beta \(2\/2\)/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(own['E2E Book Page Beta'].text, { exact: false })).toBeVisible();
  await expect(page.getByText(own['E2E Book Page Beta'].badge, { exact: true })).toBeVisible();
  await expect(page.getByText(own['E2E Book Page Alpha'].text, { exact: false })).toHaveCount(0);

  // "Previous" restores the first page's own content.
  const prevButton = page.getByRole('button', { name: 'Previous changed page' });
  await prevButton.click();

  await expect(page.getByRole('link', { name: /E2E Book Page Alpha \(1\/2\)/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(own['E2E Book Page Alpha'].text, { exact: false })).toBeVisible();

  // Click 3 — the way back to the workspace, which the breadcrumb's own
  // first crumb now carries (the screen's own hand-built "Workspace home"
  // button duplicated it and is gone).
  await crumbs.getByRole('link', { name: /E2E Workspace/ }).click();
  await expect(page).toHaveURL(workspaceUrl(fixtures.workspaceSlug), { timeout: 30000 });
});

test('an outsider with no read grant sees the same not-found state a nonexistent book would render, for both screens', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(bookHistoryUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId));
  await expect(page.getByRole('heading', { name: 'This book does not exist' })).toBeVisible({ timeout: 30000 });
  const deniedHistoryHtml = await page.content();
  expect(deniedHistoryHtml).not.toContain(fixtures.bookHistoryBookTitle);
  expect(deniedHistoryHtml).not.toContain('E2E Owner');

  await page.goto(bookHistoryUrl(fixtures.workspaceSlug, crypto.randomUUID()));
  await expect(page.getByRole('heading', { name: 'This book does not exist' })).toBeVisible({ timeout: 30000 });

  await page.goto(bookDiffUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId, { since: '2026-01-01T00:00:00.000Z' }));
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

  await page.goto(bookDiffUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId));

  await expect(page.getByRole('heading', { name: /missing its date/i })).toBeVisible({ timeout: 30000 });
});

/**
 * Review material for the owner (docs/UI-CHECKLIST.md §4.2: at least two
 * contrasting themes, one dark; §6: 320/1280). No-ops unless
 * `DEEPWIKI_BOOK_SHOTS` is set — the same gate `e2e/frame.spec.ts` uses for
 * its own screenshots, so a normal `bun run e2e` run pays nothing extra.
 */
for (const [width, themes] of [[1280, ['light', 'dark']], [320, ['light']]] as const) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const theme of themes) {
      test(`book history and book diff, ${theme}`, async ({ page, context }) => {
        await signInAs(context, fixtures.readerSessionToken);
        await useTheme(page, theme);

        await page.goto(bookHistoryUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible({ timeout: 30000 });
        await shot(page, `history-${width}-${theme}`);

        await page.getByRole('link', { name: /compare since/i }).click();
        await expect(page).toHaveURL(
          new RegExp(`^.*${bookDiffUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId)}\\?since=`),
          { timeout: 30000 },
        );
        // The switcher's current page, in the contextual bar: the sidebar's tree links the same pages beside it.
        await expect(page.locator('#content-bar').getByRole('link', { name: /E2E Book Page/ })).toBeVisible({ timeout: 30000 });
        await shot(page, `diff-${width}-${theme}`);
      });
    }
  });
}

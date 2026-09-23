import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { API_URL } from './ports';
import { pageHistoryUrl, pageUrl, workspaceUrl } from '../apps/web/app/utils/routes';

/**
 * The journey the owner actually walked, end to end, through the UI: make
 * a shelf, a book, a chapter and a page from the navigation tree, then
 * click the new page and read it.
 *
 * It exists because that journey was broken from the day pages became
 * creatable and no test in this repository walked it. The tree said
 * "Created page “parla” in “complex”.", the row appeared, the breadcrumb
 * named it — and opening it answered **"This page does not exist."**
 * `GET /pages/:id` read the `page_content` row and treated its absence as
 * the absence of the page (`apps/api/src/routes/pages.ts`, the line dating
 * to the original read route). Every fixture in every suite seeded content
 * before asking anything, so the never-saved path was never exercised:
 * the suites were green and the product's first-run flow did not work
 * (docs/TODO.md Findings, 2026-09-23).
 *
 * So this file's rule is that **nothing here is seeded but the person**
 * (`e2e/create-open-fixtures.bun.ts` mints a member with `read`/`write`/
 * `manage` on the workspace root and not one node). Every node under test
 * is made by the UI, in the order a person makes them, and the assertions
 * are what that person sees.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });

interface SeedFixtures {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
}

interface CreateOpenFixtures {
  readonly builderSessionToken: string;
  readonly run: string;
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');

function mintFixtures(): CreateOpenFixtures {
  const output = execFileSync('bun', ['run', 'e2e/create-open-fixtures.bun.ts', seed.workspaceId], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return JSON.parse(output.trim().split('\n').pop()!);
}

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

/** The tree's own row for a title — the `treeitem`, which is the tab stop and the selection. */
function row(page: Page, title: string): Locator {
  return page.getByRole('treeitem', { name: new RegExp(title) });
}

/**
 * One pass of the toolbar's "New…" dialog: pick the kind, name it, submit,
 * and wait for the row the response drew. `parentTitle` is `null` for the
 * top level, where the hierarchy leaves exactly one location and the
 * dialog offers no choice of it.
 *
 * Focus, not a click, selects the parent row: a click on a container folds
 * it (`e2e/tree-writes.spec.ts`'s own note), and the tree's focus is its
 * selection — which is what "New…" reads to decide where the new node goes.
 */
async function createFromToolbar(page: Page, parentTitle: string | null, kind: 'Shelf' | 'Book' | 'Chapter' | 'Page', title: string): Promise<void> {
  if (parentTitle) await row(page, parentTitle).focus();
  await page.getByRole('button', { name: 'New…' }).click();

  const location = page.getByTestId('tree-create-location-fixed').or(page.getByTestId('tree-create-location'));
  await expect(location).toContainText(parentTitle ?? 'top level');
  await page.getByTestId('tree-create-type').getByLabel(kind, { exact: true }).check();
  await page.getByTestId('tree-create-title').fill(title);
  await page.getByTestId('tree-create-submit').click();

  await expect(row(page, title)).toBeVisible({ timeout: 60_000 });
}

/** The four titles one run of the journey makes, unique per run so `(parent_id, slug)` never collides. */
function titles(fixtures: CreateOpenFixtures, label: string) {
  return {
    shelf: `E2E Built Shelf ${label} ${fixtures.run}`,
    book: `E2E Built Book ${label} ${fixtures.run}`,
    chapter: `E2E Built Chapter ${label} ${fixtures.run}`,
    page: `E2E Built Page ${label} ${fixtures.run}`,
  };
}

/**
 * Walks shelf → book → chapter → page from the tree and returns the
 * titles, with the dashboard already open and the builder signed in.
 */
async function buildBranch(page: Page, fixtures: CreateOpenFixtures, label: string): Promise<ReturnType<typeof titles>> {
  const built = titles(fixtures, label);
  await signInAs(page, fixtures.builderSessionToken);
  await page.goto(workspaceUrl(seed.workspaceSlug));
  // The dev server compiles the dashboard route on first visit; everything after is warm.
  await expect(page.getByRole('button', { name: 'New…' })).toBeVisible({ timeout: 180_000 });

  await createFromToolbar(page, null, 'Shelf', built.shelf);
  await createFromToolbar(page, built.shelf, 'Book', built.book);
  await createFromToolbar(page, built.book, 'Chapter', built.chapter);
  await createFromToolbar(page, built.chapter, 'Page', built.page);
  return built;
}

/*
 * The test the defect would have failed. Deliberately the whole journey in
 * one test rather than four: the owner's report is a sequence, and a
 * per-step test would have to seed the previous steps' nodes, which is the
 * habit that hid this in the first place.
 */
test('a page created from the tree opens as an empty document, not "This page does not exist"', async ({ page }) => {
  const fixtures = mintFixtures();
  const built = await buildBranch(page, fixtures, 'Open');

  // The person clicks the row they just made.
  await row(page, built.page).getByRole('link').click();

  // It opens. The page's own title is the screen's `<h1>` …
  await expect(page.getByRole('heading', { level: 1, name: built.page })).toBeVisible({ timeout: 120_000 });
  // … the not-found screen is nowhere near it …
  await expect(page.getByText('This page does not exist')).toHaveCount(0);
  await expect(page.getByText("You don't have access to this page")).toHaveCount(0);
  // … and what stands in the document's place is the empty state, with the
  // one path forward (docs/UI-CHECKLIST.md §3).
  await expect(page.getByRole('heading', { level: 2, name: 'This page is empty' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start editing' })).toBeVisible();

  // The address is this page's, so a reload — a real server render of the
  // real response — lands on the same screen rather than on a 404.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: built.page })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('This page does not exist')).toHaveCount(0);
});

/**
 * The rest of the owner's sentence: "then type and save and reload". The
 * first save of a page that has never been saved is the `contentHash: null`
 * path through `GET /pages/:id/edit-session` and `PUT /pages/:id` — and,
 * underneath it, the lock a brand-new page can now hold (`page_locks`'
 * foreign key moved off `page_content` in `0023`; before that this
 * request answered 500 the moment the 404 above was fixed).
 */
test('the empty page opens an editor, and its first save reads back after a reload', async ({ page }) => {
  const fixtures = mintFixtures();
  const built = await buildBranch(page, fixtures, 'Save');

  await row(page, built.page).getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: built.page })).toBeVisible({ timeout: 120_000 });
  // The address the tree's row led to, so the two screens below are reached
  // by a real navigation rather than by another in-app click: the first one
  // is what this test is about, and one flaky click would hide it.
  const nodeId = new URL(page.url()).pathname.split('/p/')[1]!;
  await page.getByRole('link', { name: 'Start editing' }).click();

  // The editor opens on an empty document rather than refusing. No
  // `caretToEnd` dance (`e2e/editor.spec.ts`'s helper) is needed or even
  // possible here: an empty document has exactly one caret position, so
  // the click produces no selection transaction to wait for — the typed
  // text arriving is the whole observable, and it is the one that matters.
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toBeVisible({ timeout: 120_000 });
  await editor.click();
  await page.keyboard.type('The first paragraph this page has ever held.');
  await expect(editor).toContainText('The first paragraph this page has ever held.');

  // The buffer reports 300ms after the last keystroke; Save enabling is the
  // screen's own word that it has it (e2e/editor.spec.ts's note).
  const save = page.locator('#content-bar').getByRole('button', { name: /^Save/ });
  await expect(save).not.toHaveAttribute('aria-disabled', { timeout: 30_000 });
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 60_000 });

  // Read mode now serves the content, and the empty state is gone. A fresh
  // load, not an in-app hop: this is the server rendering the row's own
  // bytes, which is what "and reload" in the owner's report means.
  await page.goto(pageUrl(seed.workspaceSlug, nodeId));
  await expect(page.getByRole('article')).toContainText('The first paragraph this page has ever held.', { timeout: 120_000 });
  await expect(page.getByRole('heading', { level: 2, name: 'This page is empty' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article')).toContainText('The first paragraph this page has ever held.', { timeout: 120_000 });

  // And the history the save minted, which was the other screen this page
  // could reach while it had no content row — "No revisions yet" there was
  // honest before the save and would be a lie after it.
  await page.goto(pageHistoryUrl(seed.workspaceSlug, nodeId));
  await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('No revisions yet')).toHaveCount(0);
});

/**
 * The API's own answers along the same journey, read directly: the three
 * routes a never-saved page is asked for, and the absence-vs-denial
 * property the fix must not have widened. A transport contract beside the
 * screen contract above (docs/UI-CHECKLIST.md §7).
 */
test('the API answers a never-saved page as empty, and still answers absence as absence', async ({ page }) => {
  const fixtures = mintFixtures();
  const built = await buildBranch(page, fixtures, 'Api');
  const headers = { cookie: `session=${fixtures.builderSessionToken}` };

  const tree = (await (await page.request.get(`${API_URL}/workspaces/${seed.workspaceId}/tree`, { headers })).json()) as {
    nodes: { title: string; children: { title: string; children: { title: string; children: { id: string; title: string }[] }[] }[] }[];
  };
  const pageId = tree.nodes
    .find((shelf) => shelf.title === built.shelf)!
    .children.find((book) => book.title === built.book)!
    .children.find((chapter) => chapter.title === built.chapter)!
    .children.find((node) => node.title === built.page)!.id;

  const read = await page.request.get(`${API_URL}/pages/${pageId}`, { headers });
  expect(read.status()).toBe(200);
  expect(await read.json()).toMatchObject({ html: '', title: built.page });

  const history = await page.request.get(`${API_URL}/pages/${pageId}/history`, { headers });
  expect(history.status()).toBe(200);
  expect((await history.json()).revisions).toEqual([]);

  const comments = await page.request.get(`${API_URL}/pages/${pageId}/comments`, { headers });
  expect(comments.status()).toBe(200);
  expect((await comments.json()).threads).toEqual([]);

  // An id that names nothing is still absent, with the same body it always had.
  const absent = await page.request.get(`${API_URL}/pages/00000000-0000-4000-8000-000000000000`, { headers });
  expect(absent.status()).toBe(404);
  expect(await absent.json()).toEqual({ error: 'not found' });
});

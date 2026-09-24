import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './overflow';
import { API_URL } from './ports';
import { pageUrl, trashUrl, workspaceUrl } from '../apps/web/app/utils/routes';

/**
 * The tree's writes are optimistic (2026-09-16; `useTree.ts`): a dropped
 * row is where it was dropped before the server has answered and stays
 * there on success, a created row is drawn from the response that made
 * it, and only a refusal puts things back — with the reason beside the
 * tree. Until then a drag snapped back to where it started until the
 * `PATCH` and a full `GET /tree` had both landed, and a new row appeared
 * on the second request (docs/TODO.md Findings, 2026-09-16).
 *
 * These tests count requests: `GET /tree` after a successful write is the
 * observable of the old behaviour, and nothing a person sees distinguishes
 * "the row moved" from "the row moved, then the whole tree was replaced
 * by an identical one" except the snap-back in between — which is also
 * measured here, by holding the `PATCH` and reading the order while it is
 * held. A transport contract, not a screen contract (docs/UI-CHECKLIST.md
 * §7): the screen's own contract is in `e2e/tree.spec.ts`.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });

interface SeedFixtures {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
}

interface TreeFixtures {
  readonly writerSessionToken: string;
  readonly shelfTitle: string;
  readonly bookId: string;
  readonly bookTitle: string;
  readonly firstPageId: string;
  readonly firstPageTitle: string;
  readonly secondPageId: string;
  readonly secondPageTitle: string;
  readonly managerSessionToken: string;
  readonly ownerSessionToken: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly hiddenPageId: string;
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');

/** Review material, written only when asked for (the frame batch's `DEEPWIKI_FRAME_SHOTS` convention). */
const SHOTS = process.env.DEEPWIKI_FRAME2_SHOTS ?? '';
/** The 2026-09-16 regression batch's own set: the row after a drag, with the tree's focus on it. */
const FIX2_SHOTS = process.env.DEEPWIKI_FIX2_SHOTS ?? '';
/** The 2026-09-23 authoring batch's own set: the page's title being renamed where it is read. */
const AUTHORING_SHOTS = process.env.DEEPWIKI_AUTHORING_SHOTS ?? '';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-frame2-${name}.png`, fullPage: false });
}

async function fix2Shot(page: Page, name: string): Promise<void> {
  if (!FIX2_SHOTS) return;
  await page.screenshot({ path: `${FIX2_SHOTS}/fb-fix2-${name}.png`, fullPage: false });
}

async function authoringShot(page: Page, name: string): Promise<void> {
  if (!AUTHORING_SHOTS) return;
  await page.screenshot({ path: `${AUTHORING_SHOTS}/authoring-${name}.png`, fullPage: false });
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

/**
 * Below `lg` the sidebar is a drawer; this opens it so the tree is on
 * screen. The toggle is server-rendered and visible before Vue has
 * attached its listener, and a click in that window reaches nothing
 * (e2e/navigation.spec.ts's note), so hydration is waited for first.
 */
async function openDrawerIfNarrow(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
  const toggle = page.getByRole('button', { name: 'Open sidebar' });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
}

/** Fresh rows per test: a reorder is a write, and a test must not inherit the order another left behind. */
function mintFixtures(): TreeFixtures {
  const output = execFileSync('bun', ['run', 'e2e/tree-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  return JSON.parse(output.trim().split('\n').pop()!);
}

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

// Once, before the counts: on a cold optimizer cache Vite discovers the
// dashboard's dependencies mid-navigation and reloads the page, and a
// reload in the middle of a held request is not the behaviour under test
// (e2e/perf.spec.ts warms its route for the same reason).
test.beforeAll(async ({ browser }) => {
  // A hook's own budget: the first compile of the dashboard route on a
  // loaded host is what this wait is for.
  test.setTimeout(240_000);
  const fixtures = mintFixtures();
  const page = await browser.newPage();
  await signInAs(page, fixtures.writerSessionToken);
  await page.goto(workspaceUrl(seed.workspaceSlug));
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.secondPageTitle) })).toBeVisible({ timeout: 120_000 });
  await page.close();
});

/** The titles of the book's own pages, in the order the tree draws them — a page row's title is a link, a container's a span, and the book also holds a chapter. */
async function pageOrder(page: Page, fixtures: TreeFixtures): Promise<string[]> {
  const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) });
  return book.locator(':scope > [role="group"] > [role="treeitem"] > .dw-tree-row > a.truncate').allTextContents();
}

/** Opens the dashboard with the writer's book unfolded and both pages on screen. */
async function openTree(page: Page, fixtures: TreeFixtures): Promise<void> {
  await signInAs(page, fixtures.writerSessionToken);
  await page.goto(workspaceUrl(seed.workspaceSlug));
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.secondPageTitle) })).toBeVisible({ timeout: 120_000 });
  expect(await pageOrder(page, fixtures)).toEqual([fixtures.firstPageTitle, fixtures.secondPageTitle]);
}

/** A native drag of `source`'s row onto the top quarter of `target`'s row: "before". */
async function dragBefore(page: Page, source: string, target: string): Promise<void> {
  const from = page.getByRole('treeitem', { name: new RegExp(source) }).locator('[draggable="true"]').first();
  const to = page.getByRole('treeitem', { name: new RegExp(target) }).locator('[draggable="true"]').first();
  const box = (await to.boundingBox())!;
  // Two moves: the first starts the drag, the second delivers a `dragover`
  // at the final point so the drop band is the one the pointer is in.
  await from.hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 4, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + 3, { steps: 5 });
  await page.mouse.up();
}

test('a drag lands at once, the PATCH follows, and no GET /tree follows a successful PATCH', async ({ page }) => {
  const fixtures = mintFixtures();
  const requests: { method: string; url: string; at: number }[] = [];
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url(), at: Date.now() }));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API_URL}/nodes/${fixtures.secondPageId}/position`, async (route) => {
    await held;
    await route.continue();
  });
  await openTree(page, fixtures);

  await dragBefore(page, fixtures.secondPageTitle, fixtures.firstPageTitle);

  // Optimistic: the row is where it was dropped while the server has not answered.
  await expect.poll(() => pageOrder(page, fixtures)).toEqual([fixtures.secondPageTitle, fixtures.firstPageTitle]);
  const patch = requests.find((r) => r.method === 'PATCH' && r.url.endsWith(`/nodes/${fixtures.secondPageId}/position`));
  expect(patch, 'the drop was written').toBeTruthy();
  const treeLoadsBefore = requests.filter((r) => r.method === 'GET' && r.url.endsWith(`/workspaces/${seed.workspaceId}/tree`)).length;
  release();

  // Settled: the row stays, nothing reloaded the tree, and the server agrees.
  await page.waitForTimeout(2_000);
  expect(await pageOrder(page, fixtures)).toEqual([fixtures.secondPageTitle, fixtures.firstPageTitle]);
  const treeLoadsAfterPatch = requests.filter(
    (r) => r.method === 'GET' && r.url.endsWith(`/workspaces/${seed.workspaceId}/tree`) && r.at >= patch!.at,
  ).length;
  expect(treeLoadsAfterPatch, `GET /tree after the PATCH (${treeLoadsBefore} before it)`).toBe(0);
  const fromServer = await page.request.get(`${API_URL}/workspaces/${seed.workspaceId}/tree`, {
    headers: { cookie: `session=${fixtures.writerSessionToken}` },
  });
  const tree = (await fromServer.json()) as { nodes: { title: string; children: { title: string; children: { title: string; type: string }[] }[] }[] };
  const book = tree.nodes.find((shelf) => shelf.title === fixtures.shelfTitle)!.children.find((node) => node.title === fixtures.bookTitle)!;
  // The book's pages; the fixture chapter stands after them, untouched.
  expect(book.children.filter((node) => node.type === 'page').map((node) => node.title)).toEqual([fixtures.secondPageTitle, fixtures.firstPageTitle]);
});

test('a refused drag snaps back and says why, beside the tree', async ({ page }) => {
  const fixtures = mintFixtures();
  await page.route(`${API_URL}/nodes/${fixtures.secondPageId}/position`, (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }),
  );
  await openTree(page, fixtures);

  await dragBefore(page, fixtures.secondPageTitle, fixtures.firstPageTitle);

  const notice = page.getByRole('alert').filter({ hasText: "That move isn't allowed" });
  await expect(notice).toBeVisible();
  expect(await pageOrder(page, fixtures)).toEqual([fixtures.firstPageTitle, fixtures.secondPageTitle]);
});

test('a created page is drawn from the response, and no GET /tree follows it', async ({ page }) => {
  const fixtures = mintFixtures();
  const requests: { method: string; url: string; at: number }[] = [];
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url(), at: Date.now() }));
  await openTree(page, fixtures);

  // Pick a page in the book — focus selects without opening (a click on
  // the book would fold it) — so "New…" resolves to "in this book". A book
  // holds two kinds, so the kind is picked and the name is then typed in
  // the row itself (2026-09-23: there is no creation dialog any more).
  await page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) }).focus();
  await page.getByRole('button', { name: 'New…' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Page' }).click();
  const title = `E2E Tree Page Three ${Date.now()}`;
  const draftField = page.locator('[data-row-editor] input');
  await expect(draftField).toBeFocused();
  await draftField.fill(title);
  await draftField.press('Enter');

  await expect(page.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible();
  const post = requests.find((r) => r.method === 'POST' && r.url.endsWith('/nodes'))!;
  expect(post).toBeTruthy();
  await page.waitForTimeout(1_000);
  const treeLoadsAfterPost = requests.filter(
    (r) => r.method === 'GET' && r.url.endsWith(`/workspaces/${seed.workspaceId}/tree`) && r.at >= post.at,
  ).length;
  expect(treeLoadsAfterPost).toBe(0);
  // Where the server put it: last among the book's pages.
  expect(await pageOrder(page, fixtures)).toEqual([fixtures.firstPageTitle, fixtures.secondPageTitle, title]);
});

/**
 * The owner's review material for this batch, at the three sizes the
 * frame batches shoot: a page row under the pointer (its title a link,
 * the row lit by the state layer), and the tree after a refused drag —
 * the row back where it was, the reason in the chip beside it. Measured
 * for sideways overflow at each, on the pane and the document.
 */
for (const [width, theme] of [
  [1280, 'light'],
  [1280, 'dark'],
  [320, 'light'],
] as const) {
  test.describe(`review material ${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('a hovered page row, and a refused drag with its notice, screenshotted with no sideways scroll', async ({ page }) => {
      const fixtures = mintFixtures();
      await useTheme(page, theme);
      await page.route(`${API_URL}/nodes/${fixtures.secondPageId}/position`, (route) =>
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }),
      );
      await signInAs(page, fixtures.writerSessionToken);
      await page.goto(workspaceUrl(seed.workspaceSlug));
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 120_000 });
      await openDrawerIfNarrow(page);
      const first = page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) });
      await expect(first).toBeVisible({ timeout: 120_000 });

      await first.locator('[draggable="true"]').first().hover();
      await expect(first.getByRole('link')).toHaveAttribute('href', pageUrl(seed.workspaceSlug, fixtures.firstPageId));
      await shot(page, `tree-row-hover-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `tree row hover ${width} ${theme}`);

      await dragBefore(page, fixtures.secondPageTitle, fixtures.firstPageTitle);
      await expect(page.getByRole('alert').filter({ hasText: "That move isn't allowed" })).toBeVisible();
      expect(await pageOrder(page, fixtures)).toEqual([fixtures.firstPageTitle, fixtures.secondPageTitle]);
      // The pointer's mousedown put focus on the dragged row's link; the
      // drag's end hands it to the `treeitem`, the tree's one tab stop
      // (2026-09-16: the first handoff, on the link's focus, cancelled the
      // native drag itself — docs/TODO.md Findings).
      await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.secondPageTitle) })).toBeFocused();
      await shot(page, `tree-drag-refused-${width}-${theme}`);
      await fix2Shot(page, `tree-after-drag-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `tree drag refused ${width} ${theme}`);
    });
  });
}

/**
 * The row's menu names the kind ("New page…" on a book), so nothing is
 * left to ask: the draft row opens under that row at once and only the
 * name is typed. Until 2026-09-23 this opened a dialog that led with the
 * name and folded the two answers behind a "Change…" disclosure; the owner
 * rejected the dialog itself, so the same principle — ask only what you do
 * not know — is now expressed by there being nothing to ask at all.
 */
test('right-click → New page… on the book names the page in the row, and creates it there', async ({ page }) => {
  const fixtures = mintFixtures();
  await openTree(page, fixtures);

  const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) });
  await book.locator('.dw-tree-row').first().click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^New page…/ }).click();

  await expect(page.getByRole('dialog'), 'nothing modal opens any more').toHaveCount(0);
  const field = page.locator('[data-row-editor] input');
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-label', 'Name of the new page');
  // The draft stands under the book, last among its children, which is
  // where `POST /nodes` will put the real row.
  const draftRows = book.locator(':scope > [role="group"] > [role="treeitem"]');
  await expect(draftRows.last()).toHaveAttribute('data-testid', 'tree-draft-row');

  const title = `E2E Page From Menu ${Date.now()}`;
  await field.fill(title);
  await field.press('Enter');

  await expect(page.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible();
  // Said in both of the places docs/UI-CHECKLIST.md §4.12 keeps: the
  // tree's always-present live region, which is what a screen reader
  // hears, and — since 2026-09-23 — the toast, which is what a sighted
  // person reads. One sentence, two surfaces, neither of them a banner
  // that stays.
  await expect(page.getByTestId('tree-menu-status')).toHaveText(`Created page “${title}” in “${fixtures.bookTitle}”.`);
  await expect(page.getByRole('status').filter({ hasText: `Created page “${title}” in “${fixtures.bookTitle}”.` })).toHaveCount(2);
});

/**
 * Delete (node-trash and navigation-tree specs; design.md Decision 8),
 * against the real API: a delete is a move to the trash, the row leaves
 * the tree before the server has answered, and the server's own answer —
 * not the tree's guess — decides what happens to a container. A manager
 * who is not the owner is stopped twice, once by the tree (children it
 * shows) and once by the server (a child it does not); the owner is asked
 * to type the container's name, and the count they agreed to is
 * re-verified. The dialog is `ConfirmDialog`, the product's one.
 */
const TRASH_SHOTS = process.env.DEEPWIKI_TRASH_SHOTS ?? '';

async function trashShot(page: Page, name: string): Promise<void> {
  if (!TRASH_SHOTS) return;
  await page.screenshot({ path: `${TRASH_SHOTS}/trash-${name}.png`, fullPage: false });
}

/** Opens the dashboard as `token` with the fixture book's rows on screen. */
async function openTreeAs(page: Page, token: string, fixtures: TreeFixtures): Promise<void> {
  await signInAs(page, token);
  await page.goto(workspaceUrl(seed.workspaceSlug));
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 120_000 });
  await openDrawerIfNarrow(page);
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.chapterTitle) })).toBeVisible({ timeout: 120_000 });
}

/** Right-click → the row's menu → "Delete…"; returns the item so a test can read its state before choosing. */
async function openDeleteFor(page: Page, title: string): Promise<ReturnType<Page['getByRole']>> {
  const row = page.getByRole('treeitem', { name: new RegExp(title) });
  await row.locator('.dw-tree-row').first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  return page.getByRole('menu').getByRole('menuitem', { name: /^Delete…/ });
}

/** The titles under the fixture book, from the server, as `token` sees them. */
async function serverBookChildren(page: Page, token: string, fixtures: TreeFixtures): Promise<string[]> {
  const response = await page.request.get(`${API_URL}/workspaces/${seed.workspaceId}/tree`, { headers: { cookie: `session=${token}` } });
  const tree = (await response.json()) as { nodes: { title: string; children: { title: string; children: { title: string }[] }[] }[] };
  const book = tree.nodes.find((shelf) => shelf.title === fixtures.shelfTitle)?.children.find((node) => node.title === fixtures.bookTitle);
  return book?.children.map((node) => node.title) ?? [];
}

test('a manager deletes an empty page: the row leaves at once, the DELETE follows, the notice links to the Trash, and focus stays in the tree', async ({ page }) => {
  const fixtures = mintFixtures();
  const requests: { method: string; url: string }[] = [];
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API_URL}/nodes/${fixtures.secondPageId}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    await held;
    await route.continue();
  });
  await openTreeAs(page, fixtures.managerSessionToken, fixtures);

  const item = await openDeleteFor(page, fixtures.secondPageTitle);
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await item.click();

  const dialog = page.getByRole('dialog', { name: `Delete “${fixtures.secondPageTitle}”?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('It moves to the trash for 30 days');
  // The safe action holds focus; the destructive one is the filled error button.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Delete' }).click();

  // Optimistic: gone while the server has not answered.
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.secondPageTitle) })).toHaveCount(0);
  expect(requests.some((r) => r.method === 'DELETE' && r.url.endsWith(`/nodes/${fixtures.secondPageId}`)), 'the delete was written').toBe(true);
  release();

  // The success is a toast now (owner decision, 2026-09-23): transient,
  // dismissible, carrying the one way back. The tree's always-present live
  // region still says it, which is the half §5 relies on.
  const toast = page.getByRole('status').filter({ hasText: `Moved “${fixtures.secondPageTitle}” to the trash.` });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('link', { name: 'Restore from Trash' })).toHaveAttribute('href', trashUrl(seed.workspaceSlug));
  await expect(page.getByTestId('tree-delete-notice')).toHaveCount(0);
  await expect(page.getByTestId('tree-menu-status')).toContainText(`Moved “${fixtures.secondPageTitle}” to the trash`);
  // The row that asked is gone, so the tree's tab stop lands on a neighbour, not on the body.
  await expect(page.locator('[role="treeitem"]:focus')).toHaveCount(1);
  // The tree re-draws after the removal; read the order once it has settled.
  await expect.poll(() => pageOrder(page, fixtures)).toEqual([fixtures.firstPageTitle]);
  expect(await serverBookChildren(page, fixtures.managerSessionToken, fixtures)).toEqual([fixtures.firstPageTitle, fixtures.chapterTitle]);
});

test('a manager who is not the owner cannot delete a container the tree shows children in: the item stays in the menu with the reason', async ({ page }) => {
  const fixtures = mintFixtures();
  await openTreeAs(page, fixtures.managerSessionToken, fixtures);

  const item = await openDeleteFor(page, fixtures.bookTitle);
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toContainText('Empty this book first — only the workspace owner can delete a book with chapters or pages in it.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
});

test('a manager deleting a chapter that only looks empty is refused by the server with the count, and the row comes back', async ({ page }) => {
  const fixtures = mintFixtures();
  await openTreeAs(page, fixtures.managerSessionToken, fixtures);
  // The chapter's one page is hidden from the manager, so the tree draws it childless and offers Delete.
  const item = await openDeleteFor(page, fixtures.chapterTitle);
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await item.click();
  const dialog = page.getByRole('dialog', { name: `Delete “${fixtures.chapterTitle}”?` });
  await dialog.getByRole('button', { name: 'Delete' }).click();

  const alert = page.getByTestId('tree-delete-error');
  await expect(alert).toHaveText(`Empty “${fixtures.chapterTitle}” before deleting it (1 page).`);
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.chapterTitle) })).toBeVisible();
  expect(await serverBookChildren(page, fixtures.managerSessionToken, fixtures)).toContain(fixtures.chapterTitle);
});

test('the owner deleting a chapter with pages types its name: a wrong name is refused, a count that changed is re-asked, and the right name deletes', async ({ page }) => {
  const fixtures = mintFixtures();
  await openTreeAs(page, fixtures.ownerSessionToken, fixtures);

  const item = await openDeleteFor(page, fixtures.chapterTitle);
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await item.click();
  await page.getByRole('dialog', { name: `Delete “${fixtures.chapterTitle}”?` }).getByRole('button', { name: 'Delete' }).click();

  // The server refused the plain delete with the count; the same dialog asks again, name to type, focused.
  const dialog = page.getByRole('dialog', { name: `Delete “${fixtures.chapterTitle}” and everything in it?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1 page will be deleted.');
  const field = dialog.getByLabel(`Type ${fixtures.chapterTitle} to confirm`);
  await expect(field).toBeFocused();
  const accept = dialog.getByRole('button', { name: 'Delete' });
  await expect(accept).toHaveAttribute('aria-disabled', 'true');
  await expect(accept).toHaveAccessibleDescription('Type the name exactly as shown.');

  // The wrong name: still unavailable, and Enter does nothing.
  await field.fill(fixtures.chapterTitle.toLowerCase());
  await expect(accept).toHaveAttribute('aria-disabled', 'true');
  await field.press('Enter');
  await expect(dialog).toBeVisible();

  // A page created underneath while the dialog is open: the count the owner agreed to is stale.
  const created = await page.request.post(`${API_URL}/nodes`, {
    headers: { cookie: `session=${fixtures.ownerSessionToken}` },
    data: { parentId: fixtures.chapterId, type: 'page', title: `E2E Tree Late Page ${Date.now()}` },
  });
  expect(created.ok(), await created.text()).toBe(true);

  await field.fill(fixtures.chapterTitle);
  await expect(accept).not.toHaveAttribute('aria-disabled', 'true');
  await accept.click();
  await expect(dialog).toContainText('The count changed while this was open.');
  await expect(dialog).toContainText('2 pages will be deleted.');
  await expect(field).toBeFocused();

  await accept.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.chapterTitle) })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Moved “${fixtures.chapterTitle}” to the trash.` })).toBeVisible();
  expect(await serverBookChildren(page, fixtures.ownerSessionToken, fixtures)).toEqual([fixtures.firstPageTitle, fixtures.secondPageTitle]);
});

test('the Delete key on a focused row opens the same question, and Escape leaves the row where it was', async ({ page }) => {
  const fixtures = mintFixtures();
  await openTreeAs(page, fixtures.managerSessionToken, fixtures);

  const row = page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) });
  await row.focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: `Delete “${fixtures.firstPageTitle}”?` });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row).toBeVisible();
  await expect(row).toBeFocused();
});

/**
 * The owner's review material for gate 1/3: the menu with Delete on a
 * page row, the server's refusal beside the tree, and the typed-name
 * dialog — at 1280 in both themes and at 320, each measured for sideways
 * overflow on the pane and the document with the dialog open.
 */
for (const [width, theme] of [
  [1280, 'light'],
  [1280, 'dark'],
  [320, 'light'],
] as const) {
  test.describe(`delete review material ${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the menu, the refusal and the force dialog, screenshotted with no sideways scroll', async ({ page }) => {
      const fixtures = mintFixtures();
      await useTheme(page, theme);
      await openTreeAs(page, fixtures.managerSessionToken, fixtures);

      const item = await openDeleteFor(page, fixtures.secondPageTitle);
      await expect(item).toBeVisible();
      await expectNoHorizontalOverflow(page, `trash menu ${width} ${theme}`);
      await trashShot(page, `menu-${width}-${theme}`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();

      await (await openDeleteFor(page, fixtures.chapterTitle)).click();
      await page.getByRole('dialog', { name: `Delete “${fixtures.chapterTitle}”?` }).getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByTestId('tree-delete-error')).toContainText('before deleting it');
      await expectNoHorizontalOverflow(page, `trash refusal ${width} ${theme}`);
      await trashShot(page, `refusal-${width}-${theme}`);

      // The owner, in the same browser: the cookie swapped, the screen reloaded.
      await openTreeAs(page, fixtures.ownerSessionToken, fixtures);
      await (await openDeleteFor(page, fixtures.chapterTitle)).click();
      await page.getByRole('dialog', { name: `Delete “${fixtures.chapterTitle}”?` }).getByRole('button', { name: 'Delete' }).click();
      const dialog = page.getByRole('dialog', { name: `Delete “${fixtures.chapterTitle}” and everything in it?` });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(`Type ${fixtures.chapterTitle} to confirm`).fill('not the name');
      await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
      await expectNoHorizontalOverflow(page, `trash force dialog ${width} ${theme}`);
      await trashShot(page, `force-dialog-${width}-${theme}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  });
}

/**
 * The tree the owner approved on 2026-09-23, driven against the real API.
 *
 * The rejection was specific: a red trash beside "New" read as *delete the
 * workspace*, and a creation dialog asked "Type" with a single "Shelf"
 * option. So the header carries three controls and nothing destructive,
 * creation and rename happen in the row, and a question with one answer is
 * never asked. Every test below is one of those sentences, made observable.
 *
 * Screenshots are the owner's review material for this gate — the earlier
 * batches' were lost with the session scratchpad, so these are the only
 * ones he has.
 */
const TREE_UX_SHOTS = process.env.DEEPWIKI_TREE_UX_SHOTS ?? '';

async function treeUxShot(page: Page, name: string): Promise<void> {
  if (!TREE_UX_SHOTS) return;
  await page.screenshot({ path: `${TREE_UX_SHOTS}/tree-ux-${name}.png`, fullPage: false });
}

/** The field a name is typed into, wherever it stands — the draft row's, or a row being renamed. */
function nameField(page: Page) {
  return page.locator('[data-row-editor] input');
}

test.describe('the tree header', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('carries exactly three controls — New…, Filter, Collapse all — and none of them destroys anything', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTree(page, fixtures);

    const header = page.getByRole('group', { name: 'Tree actions' });
    const controls = header.getByRole('button');
    await expect(controls).toHaveCount(3);
    await expect(controls.nth(0)).toHaveAccessibleName('New…');
    await expect(controls.nth(1)).toHaveAccessibleName('Filter tree');
    await expect(controls.nth(2)).toHaveAccessibleName('Collapse all');

    // The two the owner found beside New are gone from the header, and are
    // on the row's own menu instead (VS Code and Obsidian both).
    const names = (await controls.allTextContents()).join(' ') + (await controls.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? '').join(' ')));
    expect(names.toLowerCase()).not.toMatch(/delete|trash|rename/);

    await treeUxShot(page, 'header-1280-light');
    await expectNoHorizontalOverflow(page, 'tree header 1280 light');
  });

  test('Collapse all folds the tree, and says so', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTree(page, fixtures);
    const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) });
    await expect(book).toBeVisible();

    await page.getByRole('button', { name: 'Collapse all' }).click();

    await expect(book).toHaveCount(0);
    await expect(page.getByTestId('tree-menu-status')).toContainText('Collapsed');
    // Nothing left to do, and the control says why rather than vanishing.
    await expect(page.getByRole('button', { name: 'Collapse all' })).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('creating in the row', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a shelf at the top level is named in the tree at once — no menu, no dialog', async ({ page }) => {
    const fixtures = mintFixtures();
    // The owner: the one session in these fixtures that may write at the
    // workspace root, which is where a shelf goes.
    await openTreeAs(page, fixtures.ownerSessionToken, fixtures);

    await page.getByRole('button', { name: 'New…' }).click();

    // The hierarchy leaves one answer under a workspace, so nothing asked.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const field = nameField(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-label', 'Name of the new shelf');
    await expect(page.getByTestId('tree-draft-row')).toBeVisible();
    await treeUxShot(page, 'inline-create-1280-light');
    await expectNoHorizontalOverflow(page, 'inline create 1280 light');

    const title = `E2E Inline Shelf ${Date.now()}`;
    await field.fill(title);
    await field.press('Enter');

    await expect(page.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible();
    await expect(page.getByTestId('tree-draft-row')).toHaveCount(0);
    await expect(page.getByTestId('tree-menu-status')).toContainText(`Created shelf “${title}”`);
  });

  test('a book holds two kinds, so the kind is picked first and then the name is typed in the row', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTree(page, fixtures);

    // Pick the book: focus selects without opening (a click would fold it).
    await page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) }).focus();
    await page.getByRole('button', { name: 'New…' }).click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem').nth(0)).toHaveText('Chapter');
    await expect(menu.getByRole('menuitem').nth(1)).toHaveText('Page');
    await treeUxShot(page, 'type-menu-1280-light');
    await expectNoHorizontalOverflow(page, 'type menu 1280 light');

    await menu.getByRole('menuitem', { name: 'Page' }).click();
    const field = nameField(page);
    await expect(field).toHaveAttribute('aria-label', 'Name of the new page');

    const title = `E2E Inline Page ${Date.now()}`;
    await field.fill(title);
    await field.press('Enter');

    await expect(page.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible();
    // Created, then selected and opened: a page has a screen to go to.
    await expect(page).toHaveURL(/\/p\//);
  });

  test('Escape cancels and leaves no row behind', async ({ page }) => {
    const fixtures = mintFixtures();
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/nodes')) posts.push(request.url());
    });
    await openTree(page, fixtures);
    const rowsBefore = await page.getByRole('treeitem').count();

    await page.getByRole('treeitem', { name: new RegExp(fixtures.chapterTitle) }).focus();
    await page.getByRole('button', { name: 'New…' }).click();
    await expect(nameField(page)).toBeFocused();
    await nameField(page).fill('Never written');
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('tree-draft-row')).toHaveCount(0);
    await expect(page.getByRole('treeitem')).toHaveCount(rowsBefore);
    expect(posts, 'nothing was written').toEqual([]);
  });

  test('a name already taken keeps the field, with the reason beside it and the text still in it', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTree(page, fixtures);

    await page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) }).focus();
    await page.getByRole('button', { name: 'New…' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Page' }).click();

    const field = nameField(page);
    await field.fill(fixtures.firstPageTitle);
    await field.press('Enter');

    const error = page.getByTestId('tree-row-editor-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(/already/i);
    // Never renamed behind the person's back: the text they typed is still
    // theirs to fix, and the row is still being named.
    await expect(field).toHaveValue(fixtures.firstPageTitle);
    await expect(page.getByTestId('tree-draft-row')).toBeVisible();
    await expect(field).toHaveAttribute('aria-describedby', (await error.getAttribute('id'))!);
  });
});

test.describe('renaming in the row', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('F2 renames where the row stands, and Enter writes it', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTree(page, fixtures);

    const row = page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) });
    await row.focus();
    await page.keyboard.press('F2');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    const field = nameField(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-label', `Rename “${fixtures.firstPageTitle}”`);
    await expect(field).toHaveValue(fixtures.firstPageTitle);
    await treeUxShot(page, 'inline-rename-1280-light');
    await expectNoHorizontalOverflow(page, 'inline rename 1280 light');

    const renamed = `${fixtures.firstPageTitle} renamed`;
    await field.fill(renamed);
    await field.press('Enter');

    await expect(page.getByRole('treeitem', { name: new RegExp(renamed) })).toBeVisible();
    await expect(page.getByTestId('tree-menu-status')).toContainText(`Renamed to “${renamed}”.`);
    // Focus comes back to the row it was taken from (checklist §5).
    await expect(page.getByRole('treeitem', { name: new RegExp(renamed) })).toBeFocused();
  });

  test('"Rename…" from the row’s menu opens the same field, and Escape leaves the name alone', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTree(page, fixtures);

    const row = page.getByRole('treeitem', { name: new RegExp(fixtures.secondPageTitle) });
    await row.locator('.dw-tree-row').first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await treeUxShot(page, 'context-menu-1280-light');
    await page.getByRole('menu').getByRole('menuitem', { name: /^Rename…/ }).click();

    const field = nameField(page);
    await expect(field).toHaveValue(fixtures.secondPageTitle);
    await field.fill('Not saved');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.secondPageTitle) })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /Not saved/ })).toHaveCount(0);
  });
});

/**
 * The owner's review material at the three sizes the frame batches shoot.
 * The 320 pass is the one that matters most here: a field inside a 280px
 * pane, at a row's own indent, is where a sideways scroll would appear.
 */
for (const [width, theme] of [
  [1280, 'dark'],
  [320, 'light'],
] as const) {
  test.describe(`tree review material ${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the header, the draft row, the type menu, a rename and the row menu, screenshotted with no sideways scroll', async ({ page }) => {
      const fixtures = mintFixtures();
      await useTheme(page, theme);
      await signInAs(page, fixtures.writerSessionToken);
      await page.goto(workspaceUrl(seed.workspaceSlug));
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 120_000 });
      await openDrawerIfNarrow(page);
      const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) });
      await expect(book).toBeVisible({ timeout: 120_000 });

      await treeUxShot(page, `header-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `tree header ${width} ${theme}`);

      // The type menu, where the hierarchy leaves two answers.
      await book.focus();
      await page.getByRole('button', { name: 'New…' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await treeUxShot(page, `type-menu-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `type menu ${width} ${theme}`);

      // Then the name, in the row.
      await page.getByRole('menu').getByRole('menuitem', { name: 'Page' }).click();
      await expect(nameField(page)).toBeFocused();
      await nameField(page).fill('A page being named');
      await treeUxShot(page, `inline-create-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `inline create ${width} ${theme}`);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('tree-draft-row')).toHaveCount(0);

      // A rename, on the same field.
      const row = page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) });
      await row.focus();
      await page.keyboard.press('F2');
      await expect(nameField(page)).toBeFocused();
      await treeUxShot(page, `inline-rename-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `inline rename ${width} ${theme}`);
      await page.keyboard.press('Escape');

      // And the row's menu, which is where Rename… and Delete… now live.
      await row.locator('.dw-tree-row').first().click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
      await treeUxShot(page, `context-menu-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `context menu ${width} ${theme}`);
      await page.keyboard.press('Escape');
    });
  });
}

/**
 * The page's title, renamed on the page (owner decision, 2026-09-23: "El
 * title, se edita y es el mismo title del page, como en obsidian"). It
 * lives in this file rather than in a read-mode one because what it
 * asserts is a *write*: the same `PATCH /nodes/:id` the tree's own rename
 * issues, asked from the page, with the tree beside it as the witness
 * that one node's one name changed.
 */
test('the page’s title is renamed on the page: the heading, the breadcrumb and the tree row all follow, and the server agrees', async ({ page }) => {
  const fixtures = mintFixtures();
  const renamed = `${fixtures.firstPageTitle} renamed`;
  await signInAs(page, fixtures.writerSessionToken);
  await useTheme(page, 'light');
  await page.goto(pageUrl(seed.workspaceSlug, fixtures.firstPageId));

  // The tree row proves the client has attached (`NavigationTree` loads
  // under `import.meta.client`), which the title field needs.
  const row = page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) });
  await expect(row).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('heading', { level: 1, name: fixtures.firstPageTitle })).toBeVisible();

  await page.getByRole('button', { name: 'Rename this page' }).click();
  const field = page.getByTestId('page-title-field');
  await expect(field).toBeFocused();
  await authoringShot(page, 'title-editing-1280-light');
  await expectNoHorizontalOverflow(page, 'page title editing 1280 light');

  await field.fill(renamed);
  await page.keyboard.press('Enter');

  // Optimistic, and everything on the screen says the same name: the
  // heading, the breadcrumb, the tab title, and the row in the tree.
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: new RegExp(renamed) })).toBeVisible();
  await expect(page.locator('#content-bar')).toContainText(renamed);
  await expect(page).toHaveTitle(new RegExp(renamed));
  expect(await serverBookChildren(page, fixtures.writerSessionToken, fixtures)).toContain(renamed);

  // And it survives a reload, which is the only proof that the rename was
  // stored rather than drawn.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible({ timeout: 30_000 });
});

test('a title already taken by a sibling is refused: the field stays open with the typed name and the reason, and nothing is renamed', async ({ page }) => {
  const fixtures = mintFixtures();
  await signInAs(page, fixtures.writerSessionToken);
  await page.goto(pageUrl(seed.workspaceSlug, fixtures.firstPageId));
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) })).toBeVisible({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Rename this page' }).click();
  const field = page.getByTestId('page-title-field');
  await field.fill(fixtures.secondPageTitle);
  await page.keyboard.press('Enter');

  // The field comes back with the typed name still in it, the server's own
  // sentence beside it, and the page still called what it was called.
  await expect(page.getByTestId('page-title-error')).toBeVisible();
  await expect(page.getByTestId('page-title-error')).toContainText(/name/i);
  await expect(page.getByTestId('page-title-field')).toHaveValue(fixtures.secondPageTitle);
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) })).toBeVisible();
  await authoringShot(page, 'title-refused-1280-light');
  expect(await serverBookChildren(page, fixtures.writerSessionToken, fixtures)).toContain(fixtures.firstPageTitle);
});

/* ─── The tree's blank space (owner review, 2026-09-23) ───────────────────
 *
 * The owner could not make a second shelf: *"ahora ya no puedo crear más
 * estanterías aparte de la de raíz"*, *"el menú contextual no funciona
 * para crear otra estantería en el exterior del tree o base del tree"*.
 * `New…` aims at the picked row, opening any page picks that page's row,
 * and nothing un-picked one — so the top level was unreachable. VS Code's
 * explorer answers both halves with the empty area below the rows: a
 * click there clears the selection, and a right-click there is the root's
 * own menu. These two tests drive the journey that was broken, end to
 * end, against the real API.
 */
const TREE3_SHOTS = process.env.DEEPWIKI_TREE3_SHOTS ?? '';

async function tree3Shot(page: Page, name: string): Promise<void> {
  if (!TREE3_SHOTS) return;
  await page.screenshot({ path: `${TREE3_SHOTS}/tree3-${name}.png`, fullPage: false });
}

/**
 * A point inside the tree and below every row — the explorer's empty area.
 *
 * The tree is folded first, and that is a finding rather than test
 * convenience: measured against the seeded workspace at 1280×900 on
 * 2026-09-23, the last row's bottom edge *was* the tree's own, so a fully
 * unfolded tree offers no blank space to click at all. `Escape` on a row
 * is the road that always exists, and its own test below drives it.
 */
async function blankSpot(page: Page): Promise<{ x: number; y: number }> {
  await page.getByRole('button', { name: 'Collapse all' }).click();
  const box = (await page.getByRole('tree').boundingBox())!;
  const rows = page.getByRole('treeitem');
  const last = (await rows.nth((await rows.count()) - 1).boundingBox())!;
  const y = last.y + last.height + 12;
  expect(y, 'the folded tree has blank space below its rows to aim at').toBeLessThan(box.y + box.height - 4);
  return { x: box.x + 16, y };
}

/** The top-level titles the server holds for this workspace, as `token` sees them. */
async function serverShelfTitles(page: Page, token: string): Promise<string[]> {
  const response = await page.request.get(`${API_URL}/workspaces/${seed.workspaceId}/tree`, { headers: { cookie: `session=${token}` } });
  const tree = (await response.json()) as { nodes: { title: string }[] };
  return tree.nodes.map((node) => node.title);
}

test.describe('the tree’s blank space', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a second shelf is creatable after one exists: a click on the blank space clears the selection and New… aims at the top level', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTreeAs(page, fixtures.ownerSessionToken, fixtures);
    const before = await serverShelfTitles(page, fixtures.ownerSessionToken);
    expect(before.length, 'a shelf already exists — the state the owner was stuck in').toBeGreaterThan(0);

    const spot = await blankSpot(page);
    // A row is picked, exactly as opening any page picks one — and a shelf
    // is the sharpest case: with it selected, `New…` aims *inside* it.
    const shelf = page.getByRole('treeitem', { name: new RegExp(fixtures.shelfTitle) });
    await shelf.focus();
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);

    await page.mouse.click(spot.x, spot.y);

    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'New…' }).click();

    // One legal child under a workspace, so nothing is asked.
    await expect(page.getByRole('menu')).toHaveCount(0);
    const field = nameField(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-label', 'Name of the new shelf');
    await tree3Shot(page, 'root-create-1280-light');
    await expectNoHorizontalOverflow(page, 'root create 1280 light');

    const title = `E2E Second Shelf ${Date.now()}`;
    await field.fill(title);
    await field.press('Enter');

    await expect(page.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible();
    expect(await serverShelfTitles(page, fixtures.ownerSessionToken)).toContain(title);
  });

  test('a right-click on the blank space is the root’s own menu — New shelf…, and nothing that acts on a row', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTreeAs(page, fixtures.ownerSessionToken, fixtures);

    const spot = await blankSpot(page);
    // Something is picked first, so the menu is proved to aim at the root
    // rather than at whatever was selected.
    await page.getByRole('treeitem', { name: new RegExp(fixtures.shelfTitle) }).focus();
    await page.mouse.click(spot.x, spot.y, { button: 'right' });

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(1);
    await expect(menu.getByRole('menuitem').first()).toHaveText('New shelf…');
    await expectNoHorizontalOverflow(page, 'root menu 1280 light');

    await menu.getByRole('menuitem', { name: 'New shelf…' }).click();
    const field = nameField(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-label', 'Name of the new shelf');

    const title = `E2E Menu Shelf ${Date.now()}`;
    await field.fill(title);
    await field.press('Enter');

    await expect(page.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible();
    expect(await serverShelfTitles(page, fixtures.ownerSessionToken)).toContain(title);
  });

  /**
   * The keyboard's equivalent of the blank space (checklist §5) — and the
   * only road to the top level while the tree is tall enough to fill its
   * pane, which the seeded workspace is at 1280×900 with nothing folded.
   */
  test('Escape on a row clears the selection with the tree unfolded, where there is no blank space left to click', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTreeAs(page, fixtures.ownerSessionToken, fixtures);

    // Nothing is folded, so the rows reach the tree's own bottom edge.
    const treeBox = (await page.getByRole('tree').boundingBox())!;
    const rows = page.getByRole('treeitem');
    const last = (await rows.nth((await rows.count()) - 1).boundingBox())!;
    expect(last.y + last.height, 'the unfolded tree leaves no blank space').toBeGreaterThanOrEqual(treeBox.y + treeBox.height - 40);

    const page1 = page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) });
    await page1.focus();
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);

    await page.keyboard.press('Escape');

    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);
    await expect(page.getByTestId('tree-menu-status')).toContainText('Nothing is selected');
    await expect(page1).toBeFocused();

    await page.getByRole('button', { name: 'New…' }).click();
    await expect(nameField(page)).toHaveAttribute('aria-label', 'Name of the new shelf');
  });
});

/**
 * The `?` beside "Contents" (owner report, 2026-09-23: clicking it did
 * nothing, which was literally true — a `UButton` inside a `UTooltip`
 * with no `@click`). It now opens a popover that lists the keys, which is
 * what docs/UI-CHECKLIST.md §5 asks for and §6's "no inert interactions"
 * demands. Driven here rather than in a unit test because a `UPopover`'s
 * non-modal content does not mount under the component-test environment
 * at all (`KeyboardShortcutsHelp.test.ts` records the measurement).
 */
test.describe('the tree’s keyboard help', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the ? opens a popover that names every key, Escape closes it, and focus comes back to the control', async ({ page }) => {
    const fixtures = mintFixtures();
    await openTreeAs(page, fixtures.writerSessionToken, fixtures);

    const help = page.getByRole('button', { name: 'Keyboard help' });
    await expect(help).toHaveAttribute('aria-expanded', 'false');

    await help.click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    // It names the surface it opened, which is what makes the pair a
    // disclosure rather than two unrelated things (§5).
    expect(await help.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'));

    await expect(panel).toContainText('Keys in the tree');
    for (const phrase of ['move through the tree', 'renames an item where it stands', 'moves an item to the trash']) {
      await expect(panel).toContainText(phrase);
    }
    // The two chords that stand in for a pointer (§5): the drag's, and the
    // blank space's.
    await expect(panel.getByText('Alt', { exact: true })).toBeVisible();
    await expect(panel.getByText('Esc', { exact: true })).toBeVisible();
    await tree3Shot(page, 'help-1280-light');
    await expectNoHorizontalOverflow(page, 'keyboard help 1280 light');

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(help).toHaveAttribute('aria-expanded', 'false');
  });
});

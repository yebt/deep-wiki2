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

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-frame2-${name}.png`, fullPage: false });
}

async function fix2Shot(page: Page, name: string): Promise<void> {
  if (!FIX2_SHOTS) return;
  await page.screenshot({ path: `${FIX2_SHOTS}/fb-fix2-${name}.png`, fullPage: false });
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
  // the book would fold it) — so "New…" resolves to "in this book".
  await page.getByRole('treeitem', { name: new RegExp(fixtures.firstPageTitle) }).focus();
  await page.getByRole('button', { name: 'New…' }).click();
  await expect(page.getByTestId('tree-create-location-fixed').or(page.getByTestId('tree-create-location'))).toContainText(fixtures.bookTitle);
  // The toolbar guesses a book's first legal child (a chapter); this test is about a page.
  await page.getByTestId('tree-create-type').getByLabel('Page', { exact: true }).check();
  const title = `E2E Tree Page Three ${Date.now()}`;
  await page.getByTestId('tree-create-title').fill(title);
  await page.getByTestId('tree-create-submit').click();

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
 * The creation dialog asks only what it does not know (owner decision,
 * 2026-09-17). From a row's context menu — "New page…" on the book — the
 * place and the kind are answered by the invocation: the dialog is "New
 * page", leads with the name, focused, states "Page in “<book>”" with a
 * "Change…" disclosure, and creates under the book with the name alone.
 * From the toolbar, the radios show as before. Both shapes are the
 * owner's review material (`fb-editor2-dialog-*`, `DEEPWIKI_FRAME_SHOTS`).
 */
const EDITOR2_SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

async function editor2Shot(page: Page, name: string): Promise<void> {
  if (!EDITOR2_SHOTS) return;
  await page.screenshot({ path: `${EDITOR2_SHOTS}/fb-editor2-${name}.png`, fullPage: false });
}

test('right-click → New page… on the book opens a dialog that asks only for the name, and creates the page there', async ({ page }) => {
  const fixtures = mintFixtures();
  await openTree(page, fixtures);

  const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) });
  await book.locator('.dw-tree-row').first().click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^New page…/ }).click();

  const dialog = page.getByRole('dialog', { name: 'New page' });
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel('Name');
  await expect(name).toBeFocused();
  await expect(dialog.getByTestId('tree-create-summary')).toHaveText(`Page in “${fixtures.bookTitle}”`);
  await expect(dialog.getByTestId('tree-create-type')).toHaveCount(0);
  await expect(dialog.getByTestId('tree-create-location')).toHaveCount(0);
  // The name comes first in the dialog's reading order.
  const order = await dialog.locator('[data-testid="tree-create-title"], [data-testid="tree-create-summary"]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.testid));
  expect(order).toEqual(['tree-create-title', 'tree-create-summary']);

  // The disclosure turns the answers back into questions, pre-answered.
  const change = dialog.getByTestId('tree-create-change');
  await expect(change).toHaveAccessibleName('Change…');
  await expect(change).toHaveAttribute('aria-expanded', 'false');
  await change.click();
  await expect(change).toHaveAttribute('aria-expanded', 'true');
  await expect(change).toHaveAccessibleName('Hide the choices');
  await expect(dialog.getByTestId('tree-create-type').getByRole('radio', { checked: true })).toHaveAttribute('value', 'page');
  await expect(dialog.getByTestId('tree-create-location').getByRole('radio', { checked: true })).toHaveAttribute('value', fixtures.bookId);
  await change.click();
  await expect(dialog.getByTestId('tree-create-summary')).toBeVisible();

  const title = `E2E Page From Menu ${Date.now()}`;
  await name.fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible();
  expect(await pageOrder(page, fixtures)).toEqual([fixtures.firstPageTitle, fixtures.secondPageTitle, title]);
  await expect(page.getByRole('status').filter({ hasText: `Created page “${title}” in “${fixtures.bookTitle}”.` })).toHaveCount(1);
});

for (const [width, theme] of [
  [1280, 'light'],
  [1280, 'dark'],
  [320, 'light'],
] as const) {
  test.describe(`the creation dialog's two shapes ${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('pre-answered from the menu, and asking from the toolbar, screenshotted with no sideways scroll', async ({ page }) => {
      const fixtures = mintFixtures();
      await useTheme(page, theme);
      await signInAs(page, fixtures.writerSessionToken);
      await page.goto(`/workspaces/${seed.workspaceId}`);
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 120_000 });
      await openDrawerIfNarrow(page);
      const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) });
      await expect(book).toBeVisible({ timeout: 120_000 });

      await book.locator('.dw-tree-row').first().click({ button: 'right' });
      await page.getByRole('menu').getByRole('menuitem', { name: /^New page…/ }).click();
      const answered = page.getByRole('dialog', { name: 'New page' });
      await expect(answered.getByLabel('Name')).toBeFocused();
      await expect(answered.getByTestId('tree-create-summary')).toContainText(fixtures.bookTitle);
      await expectNoHorizontalOverflow(page, `dialog answered ${width} ${theme}`);
      await editor2Shot(page, `dialog-answered-${width}-${theme}`);
      await page.keyboard.press('Escape');
      await expect(answered).toBeHidden();

      // The toolbar's New… with the book picked: the kind is not known.
      await book.focus();
      await page.getByRole('button', { name: 'New…' }).click();
      const asking = page.getByRole('dialog', { name: 'New item' });
      await expect(asking).toBeVisible();
      await expect(asking.getByTestId('tree-create-type')).toBeVisible();
      await expect(asking.getByTestId('tree-create-summary')).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `dialog asking ${width} ${theme}`);
      await editor2Shot(page, `dialog-asking-${width}-${theme}`);
    });
  });
}

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

  const notice = page.getByTestId('tree-delete-notice');
  await expect(notice).toContainText(`Moved “${fixtures.secondPageTitle}” to the trash.`);
  await expect(notice.getByRole('link', { name: 'Restore from Trash' })).toHaveAttribute('href', trashUrl(seed.workspaceSlug));
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
  await expect(page.getByTestId('tree-delete-notice')).toContainText(`Moved “${fixtures.chapterTitle}” to the trash.`);
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

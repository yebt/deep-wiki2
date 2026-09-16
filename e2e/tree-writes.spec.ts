import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_URL } from './ports';

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
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');

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
  const fixtures = mintFixtures();
  const page = await browser.newPage();
  await signInAs(page, fixtures.writerSessionToken);
  await page.goto(`/workspaces/${seed.workspaceId}`);
  await expect(page.getByRole('treeitem', { name: new RegExp(fixtures.secondPageTitle) })).toBeVisible({ timeout: 120_000 });
  await page.close();
});

/** The titles of the book's pages, in the order the tree draws them. */
async function pageOrder(page: Page, fixtures: TreeFixtures): Promise<string[]> {
  const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookTitle) });
  return book.locator('[role="group"] [role="treeitem"] .dw-tree-row > span.truncate').allTextContents();
}

/** Opens the dashboard with the writer's book unfolded and both pages on screen. */
async function openTree(page: Page, fixtures: TreeFixtures): Promise<void> {
  await signInAs(page, fixtures.writerSessionToken);
  await page.goto(`/workspaces/${seed.workspaceId}`);
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
  const tree = (await fromServer.json()) as { nodes: { title: string; children: { title: string; children: { title: string }[] }[] }[] };
  const book = tree.nodes.find((shelf) => shelf.title === fixtures.shelfTitle)!.children.find((node) => node.title === fixtures.bookTitle)!;
  expect(book.children.map((node) => node.title)).toEqual([fixtures.secondPageTitle, fixtures.firstPageTitle]);
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

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_URL } from './ports';

/**
 * Edit-mode latency, measured in the browser the way the 2026-09-16
 * performance report measured it (docs/TODO.md Findings, "edit-mode
 * latency: measured causes and fixes"). Each test here pins one of the
 * report's fixes to the observable it was proved by, against the real
 * backend and this repository's own dev server — the mode the owner runs.
 *
 * These tests count requests and watch their order. docs/UI-CHECKLIST.md
 * §7 forbids request-count assertions on *screens*, because a screen's
 * contract is what a person sees; this file is not a screen contract. It
 * is the regression guard for a measured cause — a 1,030-request
 * waterfall, an import awaited after the response it could have overlapped
 * — where the request is the observable, and the only honest one.
 */

// Serial: two simultaneous first-compiles of the same dev-server route
// measurably slow each other down (e2e/editor.spec.ts's note), and the
// request counts below are per-navigation facts that a parallel worker
// warming the same module graph would blur.
test.describe.configure({ mode: 'serial' });

interface SeedFixtures {
  readonly workspaceId: string;
}

interface EditorFixtures {
  readonly writerSessionToken: string;
  readonly editablePageId: string;
  readonly editablePageTitle: string;
  readonly editablePageMarkdown: string;
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');

let fixtures: EditorFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  fixtures = JSON.parse(output.trim().split('\n').pop()!);
});

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

/**
 * Opens the read screen and waits until it is *hydrated*: "Edit" is
 * server-rendered and visible long before Vue has attached a listener to
 * it (tens of seconds, under load), and a hover in that window reaches
 * nothing. The article's title used to be fetched from `onMounted`, so
 * its presence meant hydration was done; since the read layer landed
 * (2026-09-16) the title is server-rendered too, so Nuxt's own
 * `isHydrating` is what says the listeners are attached.
 */
async function openReadScreenHydrated(page: Page): Promise<void> {
  await page.goto(`/pages/${fixtures.editablePageId}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: fixtures.editablePageTitle })).toBeVisible({ timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
      return typeof nuxt === 'function' && nuxt().isHydrating === false;
    },
    undefined,
    { timeout: 120_000 },
  );
}

/** The editor is live: ProseMirror has attached and the seeded text is in the document. */
async function expectEditorLive(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-surface')).toContainText(fixtures.editablePageMarkdown.trim(), { timeout: 120_000 });
}

/** The `"./mount"` entry of packages/editor, as the dev server names it. */
const MOUNT_CHUNK = /packages\/editor\/src\/mount\/index\.ts/;
/** The edit route's component chunk, as the dev server names it. */
const EDIT_ROUTE_CHUNK = /pages\/pages\/\[id\]\/edit\.vue/;
/**
 * The read route's component chunk, as the dev server names it. Not the
 * `?macro=true` request, which is Nuxt's route table reading every page's
 * `definePageMeta` at boot — that one is on every screen and carries no
 * component.
 */
const READ_ROUTE_CHUNK = /pages\/pages\/\[id\]\/index\.vue(?!\?macro)/;

/**
 * Fix A — prebundle reka-ui (apps/web/modules/perf-prebundle.ts).
 *
 * Measured on main at 4987cd9: 1027–1033 resources before the edit
 * screen was editable, 565 of them reka-ui modules served one by one.
 * With the package prebundled: 432. The buffer must be raised before
 * navigation — the browser keeps 250 resource entries by default and
 * silently drops the rest, which would make the waterfall *pass* this
 * assertion.
 */
test('the edit route loads in fewer than 500 requests: reka-ui is prebundled, not served file by file', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  await page.addInitScript(() => performance.setResourceTimingBufferSize(20_000));

  // Once, so the count below is a steady-state load of the route and not
  // the dev server's first compile of it — on a cold optimizer cache Vite
  // discovers the editor's dependencies mid-navigation and reloads.
  await page.goto(`/pages/${fixtures.editablePageId}/edit`);
  await expectEditorLive(page);

  await page.goto(`/pages/${fixtures.editablePageId}/edit`);
  await expectEditorLive(page);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  const rekaUi = resources.filter((name) => name.includes('reka-ui')).length;

  expect(resources.length, `${resources.length} resources, ${rekaUi} of them reka-ui`).toBeLessThan(500);
});

/**
 * Fix C — the edit chain is parallel, not serial.
 *
 * On main the mount chunk (`@deep-wiki/editor/mount`) was imported by
 * `EditorSurface` *after* the edit-session response arrived, so the two
 * longest waits of the open ran one after the other. The session is held
 * here until the chunk request has been seen — or for long enough to be
 * sure it never comes — so the order is what is asserted, not a timing.
 */
test('the editor chunk is requested while the edit-session request is still in flight', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API_URL}/pages/${fixtures.editablePageId}/edit-session`, async (route) => {
    await held;
    await route.continue();
  });
  const mountRequestedAt: number[] = [];
  page.on('request', (request) => {
    if (MOUNT_CHUNK.test(request.url())) mountRequestedAt.push(Date.now());
  });

  await page.goto(`/pages/${fixtures.editablePageId}/edit`);
  await expect(page.getByTestId('edit-skeleton')).toBeVisible({ timeout: 120_000 });
  // The session is still held. The chunk must be on the wire already.
  await expect
    .poll(() => mountRequestedAt.length, {
      timeout: 60_000,
      message: 'the editor chunk was never requested while the edit-session response was held back',
    })
    .toBeGreaterThan(0);
  const releasedAt = Date.now();
  release();

  await expectEditorLive(page);
  expect(mountRequestedAt[0]!, 'the chunk request preceded the session response').toBeLessThan(releasedAt);
});

/**
 * Fix D — the read screen warms the edit route before the click.
 *
 * In dev nothing prefetched: `NuxtLink` skips `preloadRouteComponents`
 * under `import.meta.dev`, so every one of the edit route's modules was
 * requested on the click (52 of them, measured). Pointer intent — hover
 * or focus on "Edit" — is when they should start.
 */
test('hovering "Edit" on the read screen requests the edit route and the editor chunk before the click', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  const seen: string[] = [];
  page.on('request', (request) => seen.push(request.url()));

  await openReadScreenHydrated(page);
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  seen.length = 0;

  await edit.hover();
  await expect
    .poll(() => seen.some((url) => EDIT_ROUTE_CHUNK.test(url)), { timeout: 30_000, message: 'the edit route chunk was not requested on hover' })
    .toBe(true);
  await expect
    .poll(() => seen.some((url) => MOUNT_CHUNK.test(url)), { timeout: 30_000, message: 'the editor chunk was not requested on hover' })
    .toBe(true);

  // And the hop still lands where it should.
  await edit.click();
  await expect(page).toHaveURL(new RegExp(`/pages/${fixtures.editablePageId}/edit$`));
  await expectEditorLive(page);
});

test('focusing "Edit" with the keyboard warms the same chunks', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  const seen: string[] = [];
  page.on('request', (request) => seen.push(request.url()));

  await openReadScreenHydrated(page);
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  seen.length = 0;

  await edit.focus();
  await expect
    .poll(() => seen.some((url) => EDIT_ROUTE_CHUNK.test(url)), { timeout: 30_000, message: 'the edit route chunk was not requested on focus' })
    .toBe(true);
  await expect
    .poll(() => seen.some((url) => MOUNT_CHUNK.test(url)), { timeout: 30_000, message: 'the editor chunk was not requested on focus' })
    .toBe(true);
});

/**
 * Fix D — route-change feedback. `NuxtLoadingIndicator` in `app.vue`,
 * in the primary role at 3px (docs/DESIGN-SYSTEM.md §1.2: the single most
 * important thing on the screen while a hop is in flight is that it is
 * in flight). Visible only for a hop slower than its 200 ms throttle, so
 * the route chunk is held back to make one.
 */
test('a slow hop shows the loading indicator, in the primary colour, and hides it once the screen lands', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  await page.route((url) => EDIT_ROUTE_CHUNK.test(url.href), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });

  await openReadScreenHydrated(page);
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();

  const indicator = page.locator('.nuxt-loading-indicator');
  await expect(indicator).toHaveCount(1);
  await expect(indicator).toHaveCSS('opacity', '0');

  await edit.click();
  await expect(indicator).toHaveCSS('opacity', '1', { timeout: 10_000 });
  const primary = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--ui-primary)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(indicator).toHaveCSS('background-color', primary);
  await expect(indicator).toHaveCSS('height', '3px');

  await expectEditorLive(page);
  await expect(indicator).toHaveCSS('opacity', '0', { timeout: 10_000 });
});

/**
 * The same indicator under `prefers-reduced-motion`: drawn full from its
 * first visible frame — no creeping growth to animate — and gone when
 * the screen lands (docs/UI-CHECKLIST.md §5; docs/DESIGN-SYSTEM.md §6.6,
 * "verify the reduced-motion path with the OS setting actually on").
 */
test('under prefers-reduced-motion the indicator is drawn full at once and still disappears when the screen lands', async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInAs(page, fixtures.writerSessionToken);
  await page.route((url) => EDIT_ROUTE_CHUNK.test(url.href), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });

  await openReadScreenHydrated(page);
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  const indicator = page.locator('.nuxt-loading-indicator');

  await edit.click();
  await expect(indicator).toHaveCSS('opacity', '1', { timeout: 10_000 });
  // scaleX(100%) — the identity matrix — from the first frame it is seen.
  await expect(indicator).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

  await expectEditorLive(page);
  await expect(indicator).toHaveCSS('opacity', '0', { timeout: 10_000 });
});

/**
 * Fix H — no redundant heartbeat at open. `GET /pages/:id/edit-session`
 * acquires the lock and returns its `heartbeatAt`; a `PATCH …/lock` in
 * the same instant renewed a lock that was 100 ms old. The first
 * heartbeat is one interval later.
 */
test('opening the editor sends no lock heartbeat: the session that acquired the lock is the first beat', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  const heartbeats: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/pages\/[^/]+\/lock$/.test(request.url())) heartbeats.push(request.url());
  });

  await page.goto(`/pages/${fixtures.editablePageId}/edit`);
  await expectEditorLive(page);
  // Long enough for a heartbeat fired "immediately" to have been seen;
  // far shorter than the 20 s interval.
  await page.waitForTimeout(1_500);

  expect(heartbeats, 'no PATCH …/lock in the first seconds of the session').toEqual([]);
});

/**
 * Fix D, second half — the tree's page rows are links that warm their
 * route on intent. The rows navigated with `navigateTo`, which Nuxt's
 * link prefetch never sees, so a hop from the dashboard to a page paid
 * the read route's whole module graph on the click. Now the row preloads
 * the route on `pointerenter` and on focus (`NavigationTreeNode.vue`), and
 * the click finds it warm: zero requests for the route chunk after it.
 */
test('hovering a page row in the tree requests the read route before the click, and none of it after', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  const seen: { url: string; at: number }[] = [];
  page.on('request', (request) => seen.push({ url: request.url(), at: Date.now() }));

  await page.goto(`/workspaces/${seed.workspaceId}`);
  const row = page.getByRole('treeitem', { name: new RegExp(fixtures.editablePageTitle) });
  await expect(row).toBeVisible({ timeout: 120_000 });
  // The row is server-rendered; the hover must reach a hydrated listener.
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
  expect(seen.filter((r) => READ_ROUTE_CHUNK.test(r.url)).map((r) => r.url), 'the read route is not loaded by the dashboard').toEqual([]);

  await row.locator('[draggable="true"]').first().hover();
  await expect
    .poll(() => seen.some((r) => READ_ROUTE_CHUNK.test(r.url)), { timeout: 30_000, message: 'the read route chunk was not requested on hover' })
    .toBe(true);
  // Let the hover's preload finish before the click, so what the click
  // needs is already here and not merely on its way.
  await page.waitForLoadState('networkidle');

  const clickedAt = Date.now();
  await row.locator('[draggable="true"]').first().click();
  await expect(page).toHaveURL(new RegExp(`/pages/${fixtures.editablePageId}$`));
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: fixtures.editablePageTitle })).toBeVisible({ timeout: 120_000 });

  const afterClick = seen.filter((r) => r.at >= clickedAt && READ_ROUTE_CHUNK.test(r.url));
  expect(afterClick, 'route chunk requests after the click').toEqual([]);
});

/**
 * The same page row, as a link the browser understands: `href` is the
 * page's address, so "open in a new tab" and "copy link" work as they do
 * on any link, while the tree itself is still one tab stop.
 */
test('a page row carries a real href and stays out of the tab order', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  await page.goto(`/workspaces/${seed.workspaceId}`);
  const row = page.getByRole('treeitem', { name: new RegExp(fixtures.editablePageTitle) });
  await expect(row).toBeVisible({ timeout: 120_000 });

  const link = row.getByRole('link', { name: new RegExp(fixtures.editablePageTitle) });
  await expect(link).toHaveAttribute('href', `/pages/${fixtures.editablePageId}`);
  await expect(link).toHaveAttribute('tabindex', '-1');
});

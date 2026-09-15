import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * The workspace frame, measured in a real browser: a persistent sidebar
 * carrying the tree beside a content pane whose top bar is contextual,
 * a dashboard that uses the width in columns, the read page's article
 * centred *inside* that pane, and — below `lg` — a drawer in place of
 * the sidebar. happy-dom has no layout engine, so every number here is
 * this file's to hold (docs/UI-CHECKLIST.md §6: measure the rendered
 * box; never trust a screenshot for overflow).
 *
 * The screenshots this file writes are the owner's review material for
 * the 2026-09-15 frame; the assertions are what keeps them honest.
 */

interface Fixtures {
  readonly readPageId: string;
  readonly historyPageId: string;
  readonly workspaceId: string;
  readonly readerSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

/** §7.2: the navigation pane is 280px by default, resizable and persisted. */
const SIDEBAR_WIDTH = 280;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

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
  await page.screenshot({ path: `${SHOTS}/frame-${name}.png`, fullPage: false });
}

/** The second batch's review material: focus mode and the comments toggle. */
async function shot2(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/frame2-${name}.png`, fullPage: false });
}

function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`1280x900 ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the dashboard stands beside a 280px sidebar and lays its panels out in columns', async ({ page, context }) => {
      await signInAs(context, fixtures.readerSessionToken);
      await useTheme(page, theme);

      await page.goto(`/workspaces/${fixtures.workspaceId}`);
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

      // The sidebar: the tree is at hand, and it is the navigation landmark.
      const sidebar = page.getByRole('navigation', { name: 'Workspace' });
      await expect(sidebar).toBeVisible();
      const sidebarBox = (await sidebar.boundingBox())!;
      expect(sidebarBox.x).toBe(0);
      expect(Math.abs(sidebarBox.width - SIDEBAR_WIDTH), `sidebar width ${sidebarBox.width}`).toBeLessThanOrEqual(1);
      await expect(sidebar.getByRole('treeitem').first()).toBeVisible({ timeout: 30000 });

      // The width goes to the columns: three of them, the changes list
      // taking two.
      const recent = page.getByRole('region', { name: 'Recent changes' });
      const editing = page.getByRole('region', { name: 'Editing now' });
      const threads = page.getByRole('region', { name: 'Threads for you' });
      await expect(recent).toBeVisible();
      const recentBox = (await recent.boundingBox())!;
      const editingBox = (await editing.boundingBox())!;
      const threadsBox = (await threads.boundingBox())!;
      expect(recentBox.x, 'panels start right of the sidebar').toBeGreaterThan(SIDEBAR_WIDTH);
      expect(editingBox.x, 'the side column stands beside the changes list').toBeGreaterThan(recentBox.x + recentBox.width);
      expect(Math.abs(editingBox.y - recentBox.y), 'the two top panels share a top edge').toBeLessThanOrEqual(1);
      expect(threadsBox.y, 'the side panels stack').toBeGreaterThan(editingBox.y + editingBox.height);
      expect(recentBox.width / editingBox.width, 'the changes list is about twice a side panel').toBeGreaterThan(1.8);

      // The frame is the viewport: nothing scrolls but the pane.
      const box = await overflow(page);
      expect(box.scrollHeight).toBe(box.innerHeight);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);

      await shot(page, `dashboard-1280-${theme}`);
    });

    test('the read page keeps its 72ch article, centred in the content pane beside the tree, with the breadcrumb and Edit above it', async ({
      page,
      context,
    }) => {
      await signInAs(context, fixtures.readerSessionToken);
      await useTheme(page, theme);

      await page.goto(`/pages/${fixtures.readPageId}`);
      const title = page.getByRole('heading', { level: 1, name: 'E2E Read Page' });
      await expect(title).toBeVisible({ timeout: 30000 });

      const sidebar = page.getByRole('navigation', { name: 'Workspace' });
      await expect(sidebar.getByRole('treeitem', { name: /E2E Read Page/ })).toBeVisible({ timeout: 30000 });
      // The open page is the current row.
      await expect(sidebar.locator('[role="treeitem"][aria-current="page"]')).toHaveCount(1);

      // The contextual bar: where the person is, then what they can do.
      const crumbs = page.getByRole('navigation', { name: 'Where you are' });
      await expect(crumbs).toContainText('E2E Read Page');
      await expect(crumbs).toContainText('E2E Workspace');
      await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Revision history' })).toBeVisible();

      // The article: still the reading measure (§4.4), but centred in the
      // pane — not at x=32 with the rest of the viewport empty, and not
      // in the middle of nothing either.
      const article = (await page.locator('article').boundingBox())!;
      const sidebarBox = (await sidebar.boundingBox())!;
      const paneLeft = sidebarBox.x + sidebarBox.width;
      const paneWidth = 1280 - paneLeft;
      expect(article.width, `article width ${article.width}`).toBeLessThan(720);
      expect(article.width, `article width ${article.width}`).toBeGreaterThan(600);
      const leftGap = article.x - paneLeft;
      const rightGap = 1280 - (article.x + article.width);
      expect(Math.abs(leftGap - rightGap), `centred in the pane: left ${leftGap}, right ${rightGap}`).toBeLessThanOrEqual(2);
      expect(article.x, 'the article is inside the pane').toBeGreaterThan(paneLeft);
      expect(paneWidth).toBeGreaterThan(article.width);

      const box = await overflow(page);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);

      await shot(page, `read-1280-${theme}`);
    });
  });
}

/**
 * The frame is mounted once — `layouts/workspace.vue` — and a navigation
 * inside the workspace swaps only the content pane. The proof is what a
 * component test cannot give: the sidebar is the *same DOM node* after
 * the click, and the tree keeps the scroll offset and the fold the
 * person gave it. Before the layout every route rebuilt the sidebar, the
 * tree scrolled back to the top on every click, and this test would have
 * failed on its first assertion. The viewport is short so the tree has
 * something to scroll.
 */
test.describe('the sidebar survives a navigation', () => {
  test.use({ viewport: { width: 1280, height: 380 } });

  test('the tree keeps its DOM, its scroll offset and its fold when a row opens a page', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, 'light');

    await page.goto(`/workspaces/${fixtures.workspaceId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });
    const sidebar = page.getByRole('navigation', { name: 'Workspace' });
    const tree = sidebar.getByRole('tree');
    await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 30000 });

    // Fold one book, scroll the list by half a row — so the second row is
    // fully in view whatever the list's length — and mark the sidebar's
    // element.
    const book = tree.getByRole('treeitem', { name: /E2E Book History Handbook/ });
    await expect(book).toHaveAttribute('aria-expanded', 'true');
    await book.getByText('E2E Book History Handbook', { exact: true }).click();
    await expect(book).toHaveAttribute('aria-expanded', 'false');
    const scrolled = await tree.evaluate((el) => {
      el.scrollTop = 20;
      return { scrollTop: el.scrollTop, scrollable: el.scrollHeight > el.clientHeight };
    });
    expect(scrolled.scrollable, 'the tree has something to scroll at this height').toBe(true);
    expect(scrolled.scrollTop).toBe(20);
    await sidebar.evaluate((el) => {
      (el as HTMLElement & { __dwFrameProbe?: string }).__dwFrameProbe = 'mounted-once';
    });

    // A row that is fully in view after the scroll: the first row is
    // partly above the fold, and focusing a clipped row on click makes the
    // browser itself scroll it into view — a scroll that would be real,
    // but not the frame's.
    await tree.getByRole('treeitem', { name: /E2E History Page/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'E2E History Page' })).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(new RegExp(`/pages/${fixtures.historyPageId}$`));

    // The same node, not a rebuilt one — and everything it held.
    expect(await sidebar.evaluate((el) => (el as HTMLElement & { __dwFrameProbe?: string }).__dwFrameProbe)).toBe('mounted-once');
    expect(await tree.evaluate((el) => el.scrollTop)).toBe(scrolled.scrollTop);
    await expect(tree.getByRole('treeitem', { name: /E2E Book History Handbook/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar.locator('[role="treeitem"][aria-current="page"]')).toHaveCount(1);
  });
});

/**
 * Focus mode: the sidebar hidden to nothing and the document alone,
 * from a control in the contextual bar or `Ctrl`/`⌘`+`\`, persisted
 * beside the sidebar's width, announced, and — below `lg` — without any
 * effect on the drawer. Measured: the sidebar is gone (not a rail), the
 * article keeps its 72ch and is centred in the whole viewport, and focus
 * does not fall to the body when the pane it was in disappears.
 */
for (const theme of ['light', 'dark'] as const) {
  test.describe(`focus mode 1280x900 ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('hides the sidebar to nothing, gives the article the whole pane, survives a reload, and comes back on the keys', async ({
      page,
      context,
    }) => {
      await signInAs(context, fixtures.readerSessionToken);
      await useTheme(page, theme);

      await page.goto(`/pages/${fixtures.readPageId}`);
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Read Page' })).toBeVisible({ timeout: 30000 });
      const sidebar = page.getByRole('navigation', { name: 'Workspace' });
      await expect(sidebar).toBeVisible();
      const before = (await page.locator('article').boundingBox())!;

      const hide = page.getByRole('button', { name: 'Hide sidebar' });
      await expect(hide).toBeVisible();
      await hide.click();

      await expect(sidebar).toBeHidden();
      await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: /^Sidebar hidden\. Press .+ to show it\.$/ })).toHaveCount(1);
      // No rail: nothing stands between the viewport's left edge and the pane.
      const bar = (await page.locator('#content-bar').boundingBox())!;
      expect(bar.x, 'the content pane starts at the viewport edge').toBe(0);
      // The 72ch measure holds and the article is centred in the whole width.
      const after = (await page.locator('article').boundingBox())!;
      expect(Math.abs(after.width - before.width), `article width ${before.width} → ${after.width}`).toBeLessThanOrEqual(1);
      const leftGap = after.x;
      const rightGap = 1280 - (after.x + after.width);
      expect(Math.abs(leftGap - rightGap), `centred in the viewport: left ${leftGap}, right ${rightGap}`).toBeLessThanOrEqual(2);
      const box = await overflow(page);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);

      await shot2(page, `read-focus-1280-${theme}`);

      // Persisted: the next visit opens on the document alone, with no
      // sidebar flashing by first.
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Read Page' })).toBeVisible({ timeout: 30000 });
      await expect(sidebar).toBeHidden();
      await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();

      // The keys bring it back, from anywhere on the page.
      await page.locator('article').click();
      await page.keyboard.press('Control+\\');
      await expect(sidebar).toBeVisible();
      await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Sidebar shown.' })).toHaveCount(1);
    });
  });
}

test.describe('focus mode and the keyboard', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('hiding the sidebar while focus is inside it moves focus to the content bar rather than losing it', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);

    await page.goto(`/pages/${fixtures.readPageId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Read Page' })).toBeVisible({ timeout: 30000 });
    const sidebar = page.getByRole('navigation', { name: 'Workspace' });
    const row = sidebar.getByRole('treeitem', { name: /E2E Read Page/ });
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.focus();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('treeitem');

    await page.keyboard.press('Control+\\');

    await expect(sidebar).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id), 'focus landed on the content bar').toBe('content-bar');
    // And the next Tab is this screen's first control, not nothing.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Show sidebar');
  });
});

/**
 * `/` opens onto the last workspace the person was in, the way Obsidian
 * reopens the last vault (apps/web/PRODUCT.md). The memory is a cookie,
 * so the redirect resolves on the server: the list never flashes by.
 * `e2e/navigation.spec.ts` holds the other case — a fresh browser with
 * nothing remembered lands on the list.
 */
test.describe('the front door', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('after visiting a workspace, `/` opens onto it rather than the list', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);

    await page.goto(`/workspaces/${fixtures.workspaceId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });

    await page.goto('/');

    await expect(page).toHaveURL(new RegExp(`/workspaces/${fixtures.workspaceId}$`), { timeout: 30000 });
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });
    // The list was never rendered on the way: the server answered `/` with the redirect.
    const response = await page.request.get('/', { maxRedirects: 0 });
    expect(response.status(), 'the server redirects `/` itself').toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()['location']).toContain(`/workspaces/${fixtures.workspaceId}`);
  });
});

test.describe('320x900 light', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('the sidebar collapses into a drawer opened from the top bar; the dashboard is one column; nothing scrolls sideways — focus mode or not', async ({
    page,
    context,
  }) => {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, 'light');
    // Focus mode persisted from a wide screen: below `lg` it has no
    // effect — the sidebar is a drawer here either way, and the focus-mode
    // control is not offered because it would do nothing.
    await context.addCookies([
      { name: 'dw-frame-sidebar-workspace', value: encodeURIComponent(JSON.stringify({ size: 17.5, collapsed: true })), domain: 'localhost', path: '/' },
    ]);

    await page.goto(`/workspaces/${fixtures.workspaceId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });

    // No persistent sidebar; the content takes the width.
    const persistent = page.getByRole('navigation', { name: 'Workspace' });
    await expect(persistent).toBeHidden();
    const recent = page.getByRole('region', { name: 'Recent changes' });
    const editing = page.getByRole('region', { name: 'Editing now' });
    const recentBox = (await recent.boundingBox())!;
    const editingBox = (await editing.boundingBox())!;
    expect(recentBox.x).toBeLessThan(SIDEBAR_WIDTH);
    expect(editingBox.y, 'one column: the panels stack').toBeGreaterThan(recentBox.y + recentBox.height);
    expect(Math.abs(editingBox.x - recentBox.x)).toBeLessThanOrEqual(1);

    let box = await overflow(page);
    expect(box.scrollWidth, 'no horizontal body scroll at 320').toBeLessThanOrEqual(box.innerWidth);
    expect(box.scrollHeight).toBe(box.innerHeight);

    await shot(page, 'dashboard-320-light');
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeHidden();

    // The drawer: opened from the top bar, holds the same tree, traps
    // focus, and closes on Escape (§6).
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('treeitem').first()).toBeVisible({ timeout: 30000 });
    await expect(drawer.getByRole('link', { name: 'Members' })).toBeVisible();
    // Let the slide-in finish before measuring or photographing it.
    // `allSettled`: an animation a re-render cancels midway rejects its
    // `finished`, and a cancelled animation is as done as a finished one.
    await drawer.evaluate((el) => Promise.allSettled(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    const drawerBox = (await drawer.boundingBox())!;
    expect(drawerBox.x, 'the drawer is flush with the left edge').toBe(0);
    expect(drawerBox.width, 'the drawer fits the viewport').toBeLessThanOrEqual(320);
    box = await overflow(page);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth);

    await shot(page, 'drawer-320-light');

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './overflow';
import { workspaceUrl } from '../apps/web/app/utils/routes';

/**
 * The navigation tree's two 2026-09-16 additions, driven in a real
 * browser: the context menu on every row, and the toggleable filter
 * above the tree.
 *
 * The menu's tests use the writer `e2e/editor-fixtures.bun.ts` mints —
 * a caller with `write` on exactly one page — because "Rename…" from
 * the menu has to land on the server and come back as the row's new
 * title, which a read-only session cannot prove. The filter's tests use
 * the seeded reader, who can see a shelf, a book and four pages: enough
 * to show that a match keeps its ancestors and drops its cousins.
 *
 * `page.keyboard.press('Shift+F10')` is the real key chord, not a
 * synthetic event: the tree handles the chord itself and the test
 * proves the browser delivers it.
 */

interface SeedFixtures {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly readerSessionToken: string;
  readonly bookHistoryShelfTitle: string;
  readonly bookHistoryBookTitle: string;
}

interface EditorFixtures {
  readonly writerSessionToken: string;
  readonly editablePageId: string;
  readonly editablePageTitle: string;
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');
const SHOTS = process.env.DEEPWIKI_TREE_SHOTS ?? '';

let writer: EditorFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  writer = JSON.parse(output.trim().split('\n').pop()!);
});

test.describe.configure({ mode: 'serial', timeout: 120_000 });

/**
 * The first row's wait. Every test here starts on the dashboard route,
 * which the dev server compiles on first visit; on a host running several
 * worktrees' suites at once that first hydration was measured well past
 * 30s (2026-09-16), while nothing was broken. The wait is for the row,
 * not for time: a fast host pays nothing.
 */
const FIRST_ROW_TIMEOUT = 90_000;

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
  await page.screenshot({ path: `${SHOTS}/fb-tree-${name}.png`, fullPage: false });
}

/**
 * Below `lg` the sidebar is a drawer; this opens it so the tree is on
 * screen. The toggle is server-rendered and visible before Vue has
 * attached its listener, and a click in that window reaches nothing
 * (e2e/navigation.spec.ts's note) — seen at 320 on 2026-09-16 once the
 * tree became client-only and the window grew — so hydration is waited
 * for first.
 */
async function openDrawerIfNarrow(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
  const toggle = page.getByRole('button', { name: 'Open sidebar' });
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
}

test.describe('the row context menu', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('right-click → Rename… on a page renames it in the row itself', async ({ page, context }) => {
    await signInAs(context, writer.writerSessionToken);
    await page.goto(workspaceUrl(seed.workspaceSlug));

    const row = page.getByRole('treeitem', { name: new RegExp(writer.editablePageTitle) });
    await expect(row).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });

    await row.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    // Right-clicking picked the row. (A CSS locator: while the modal
    // menu is open the rest of the page is `aria-hidden`, so a role
    // query for the row finds nothing — correctly.)
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toContainText(writer.editablePageTitle);

    // A page holds nothing, so nothing is offered to create; it opens
    // and has a history; the moves on an only child stay in the menu,
    // disabled, and say why.
    await expect(menu.getByRole('menuitem', { name: /^New / })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: /^Open/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Page history/ })).toBeVisible();
    const moveUp = menu.getByRole('menuitem', { name: /^Move up/ });
    await expect(moveUp).toHaveAttribute('aria-disabled', 'true');
    await expect(moveUp).toContainText('Already first');
    // Delete is offered on every row; this writer holds `write` and not
    // `manage`, so it stays in the menu with its reason on show
    // (navigation-tree spec; `e2e/tree-writes.spec.ts` drives the flow).
    const remove = menu.getByRole('menuitem', { name: /^Delete…/ });
    await expect(remove).toHaveAttribute('aria-disabled', 'true');
    await expect(remove).toContainText('manage access');

    await menu.getByRole('menuitem', { name: /^Rename…/ }).click();

    // In the row, not in a dialog (owner criterion, 2026-09-23): the field
    // opens on the current title, selected whole, where the row stands.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const field = page.locator('[data-row-editor] input');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(writer.editablePageTitle);
    const renamed = `${writer.editablePageTitle} (renamed)`;
    await field.fill(renamed);
    await field.press('Enter');

    await expect(page.getByRole('treeitem', { name: new RegExp(renamed.replace(/[()]/g, '\\$&')) })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('status').filter({ hasText: `Renamed to “${renamed}”.` })).toHaveCount(1);
  });

  test('Shift+F10 opens the menu on the focused row; arrows walk it; Escape closes it and focus is back on the row', async ({
    page,
    context,
  }) => {
    await signInAs(context, seed.readerSessionToken);
    await page.goto(workspaceUrl(seed.workspaceSlug));

    const book = page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryBookTitle) });
    await expect(book).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });
    await book.focus();
    await expect(book).toBeFocused();

    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^New chapter…/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^New page…/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Book history/ })).toBeVisible();
    // Only a page has an address: the item stays, disabled, with its reason.
    const copy = menu.getByRole('menuitem', { name: /^Copy link/ });
    await expect(copy).toHaveAttribute('aria-disabled', 'true');
    await expect(copy).toContainText('Only a page');

    // Opened from the keyboard, the first item takes focus at once, and
    // the arrows walk from there.
    await expect(menu.getByRole('menuitem', { name: /^New chapter…/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: /^New page…/ })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(book).toBeFocused();
    // The tree is still one tab stop, and it is that row.
    await expect(page.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
  });

  test('the ⋯ button opens the same menu, and the menu is inside the viewport', async ({ page, context }) => {
    await signInAs(context, seed.readerSessionToken);
    await page.goto(workspaceUrl(seed.workspaceSlug));

    const shelf = page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryShelfTitle) });
    await expect(shelf).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });
    const trigger = shelf.getByRole('button', { name: `Actions for ${seed.bookHistoryShelfTitle}` });
    await shelf.hover();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    // A CSS locator: the open modal menu makes the rest of the page `aria-hidden`.
    await expect(page.locator(`button[aria-label="Actions for ${seed.bookHistoryShelfTitle}"]`)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem', { name: /^New book…/ })).toBeVisible();
    const box = (await menu.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

test.describe('the filter', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('toggle → type → matches with their ancestors, marked and counted → Escape clears, hides and returns focus to the tree', async ({
    page,
    context,
  }) => {
    await signInAs(context, seed.readerSessionToken);
    await page.goto(workspaceUrl(seed.workspaceSlug));

    const shelf = page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryShelfTitle) });
    await expect(shelf).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });
    const before = await page.getByRole('treeitem').count();
    expect(before).toBeGreaterThan(3);

    // Hidden by default, behind a named toggle that says what it controls.
    const toggle = page.getByRole('button', { name: 'Filter tree' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const box = page.getByRole('searchbox', { name: 'Filter tree by title' });
    await expect(box).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();
    const boxHeight = (await box.boundingBox())!.height;
    expect(boxHeight, 'the filter field is the tree row height, 40px').toBeLessThanOrEqual(41);
    expect(boxHeight).toBeGreaterThanOrEqual(39);

    // Type: the book's page A matches; its book and shelf stay as the road
    // to it; the rest of the tree is gone; the match is marked.
    await box.fill('page alpha');
    await expect(page.getByRole('treeitem', { name: /Page Alpha/ })).toBeVisible();
    await expect(shelf).toBeVisible();
    await expect(page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryBookTitle) })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /E2E Read Page/ })).toHaveCount(0);
    await expect(page.locator('[role="treeitem"] mark')).toHaveCount(1);
    await expect(page.locator('[role="treeitem"] mark')).toHaveText(/page alpha/i);
    await expect(page.getByRole('status').filter({ hasText: 'match for “page alpha”' })).toHaveCount(1);
    await expectNoHorizontalOverflow(page, 'filter active 1280');

    // No match is its own state, with the way out beside it.
    await box.fill('nothing like this');
    await expect(page.getByText(/no shelves, books, chapters or pages match/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filter' })).toBeVisible();
    await expect(page.getByRole('tree')).toHaveCount(0);

    // Escape: cleared, hidden, and focus is on a row of the tree.
    await box.fill('page alpha');
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('treeitem')).toHaveCount(before);
    await expect(page.locator('[role="treeitem"]:focus')).toHaveCount(1);
  });

  test('the person’s folds survive the filter, and Ctrl+Shift+F opens it from the sidebar only', async ({ page, context }) => {
    await signInAs(context, seed.readerSessionToken);
    await page.goto(workspaceUrl(seed.workspaceSlug));

    const shelf = page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryShelfTitle) });
    await expect(shelf).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });
    const book = page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryBookTitle) });

    // Fold the shelf.
    await shelf.focus();
    await page.keyboard.press('Enter');
    await expect(shelf).toHaveAttribute('aria-expanded', 'false');
    await expect(book).toHaveCount(0);

    // The chord from inside the sidebar opens the box; the match inside
    // the folded shelf is shown anyway.
    await page.keyboard.press('Control+Shift+F');
    const box = page.getByRole('searchbox', { name: 'Filter tree by title' });
    await expect(box).toBeFocused();
    await box.fill('page alpha');
    await expect(shelf).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('treeitem', { name: /Page Alpha/ })).toBeVisible();

    // Cleared: the fold is exactly as it was left.
    await box.fill('');
    await expect(shelf).toHaveAttribute('aria-expanded', 'false');
    await expect(book).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);

    // The chord from the content pane does nothing to the tree.
    await page.getByRole('heading', { level: 1, name: 'E2E Workspace' }).click();
    await page.keyboard.press('Control+Shift+F');
    await expect(box).toHaveCount(0);
  });
});

for (const [width, theme] of [
  [1280, 'light'],
  [1280, 'dark'],
  [320, 'light'],
] as const) {
  test.describe(`review material ${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the open menu, screenshotted, with no sideways scroll', async ({ page, context }) => {
      await signInAs(context, seed.readerSessionToken);
      await useTheme(page, theme);
      await page.goto(workspaceUrl(seed.workspaceSlug));
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });
      await openDrawerIfNarrow(page);

      const book = page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryBookTitle) });
      await expect(book).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });
      // The book's own row, not the item: the `treeitem` holds its
      // children too, and its centre is a page.
      await book.locator('[draggable="true"]').first().click({ button: 'right' });
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: /^New chapter…/ })).toBeVisible();
      // Inside the viewport at every width: at 320 the reasons under the
      // items are longer than the screen, and the menu has to cap its
      // width rather than run off the edge (measured clipped 2026-09-16).
      const box = (await menu.boundingBox())!;
      expect(box.x, `menu left at ${width}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `menu right edge at ${width}`).toBeLessThanOrEqual(width);
      await shot(page, `menu-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `menu ${width} ${theme}`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
    });

    test('the active filter, screenshotted, with no sideways scroll', async ({ page, context }) => {
      await signInAs(context, seed.readerSessionToken);
      await useTheme(page, theme);
      await page.goto(workspaceUrl(seed.workspaceSlug));
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: FIRST_ROW_TIMEOUT });
      await openDrawerIfNarrow(page);

      await expect(page.getByRole('treeitem', { name: new RegExp(seed.bookHistoryBookTitle) })).toBeVisible({ timeout: 30000 });
      await page.getByRole('button', { name: 'Filter tree' }).click();
      const box = page.getByRole('searchbox', { name: 'Filter tree by title' });
      await box.fill('page');
      await expect(page.locator('[role="treeitem"] mark').first()).toBeVisible();
      await shot(page, `filter-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `filter ${width} ${theme}`);

      await box.fill('nothing like this');
      await expect(page.getByRole('button', { name: 'Clear filter' })).toBeVisible();
      await shot(page, `filter-empty-${width}-${theme}`);
      await expectNoHorizontalOverflow(page, `filter empty ${width} ${theme}`);
    });
  });
}

import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';
import { expectNoHorizontalOverflow } from './overflow';
import { membersUrl, settingsUrl, workspaceUrl } from '../apps/web/app/utils/routes';

/**
 * The management sidebar: on a management screen the sidebar switches
 * from the tree to everything that is management, the door of the open
 * screen is marked current, and the way back returns the tree — in the
 * running browser, by clicking, never by typing an address past the
 * first (docs/UI-CHECKLIST.md §7). Below `lg` the same region stands in
 * the drawer, measured for overflow at 320.
 *
 * The caller is the seeded reader, who holds `read` on one page and no
 * `manage`: the members screen shows them its "nothing to manage here"
 * state, and the sidebar switches regardless — the switch is the route's,
 * not the response's. The screenshots this file writes
 * (`fb-manage-*.png`) are the owner's review material.
 */

interface Fixtures {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly readerSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

/** Serial, with the frame's own budget: the dev server compiles each route on first visit (see e2e/frame.spec.ts). */
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
  await page.screenshot({ path: `${SHOTS}/fb-manage-${name}.png`, fullPage: false });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`1280x900 ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('members swaps the tree for the management doors with Members current; a placeholder door opens an honest screen; back returns the tree', async ({
      page,
      context,
    }) => {
      await signInAs(context, fixtures.readerSessionToken);
      await useTheme(page, theme);

      await page.goto(workspaceUrl(fixtures.workspaceSlug));
      // The first route of the run is compiled on demand by the dev server; measured at 38s cold on 2026-09-16.
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 60000 });
      const sidebar = page.getByRole('navigation', { name: 'Workspace' });
      await expect(sidebar.getByRole('tree')).toBeVisible({ timeout: 30000 });
      await expect(sidebar.getByRole('navigation', { name: 'Management' })).toHaveCount(0);

      // Click 1 — the Members door in the sidebar's footer.
      await sidebar.getByRole('link', { name: 'Members' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible({ timeout: 30000 });

      // The tree is gone; everything that is management stands in its
      // place, grouped, with the open screen's door marked.
      await expect(sidebar.getByRole('tree')).toHaveCount(0);
      const management = sidebar.getByRole('navigation', { name: 'Management' });
      await expect(management).toBeVisible();
      for (const label of ['Workspace', 'Instance', 'You']) {
        await expect(management.getByText(label, { exact: true })).toBeVisible();
      }
      const current = management.locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText('Members');
      // The doors that moved into the sections stand once, not twice.
      await expect(sidebar.getByRole('link', { name: 'Members' })).toHaveCount(1);
      await expect(sidebar.getByRole('link', { name: 'Registration settings' })).toHaveCount(1);
      // The pane's header still names the room.
      await expect(sidebar.getByRole('button', { name: /E2E Workspace/ })).toBeVisible();
      await expectNoHorizontalOverflow(page, `members 1280 ${theme}`);
      await shot(page, `members-1280-${theme}`);

      // Click 2 — a door that is not built yet opens a screen that says so.
      await management.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({ timeout: 30000 });
      await expect(page).toHaveURL(new RegExp(`${settingsUrl(fixtures.workspaceSlug)}$`));
      await expect(page.getByRole('main').getByRole('status')).toContainText(/not built yet/i);
      await expect(management.locator('[aria-current="page"]')).toHaveText('Settings');
      await expectNoHorizontalOverflow(page, `settings 1280 ${theme}`);
      await shot(page, `settings-1280-${theme}`);

      // Click 3 — the instance's door: the same frame, the same sidebar,
      // the eyebrow saying whose setting this is.
      await management.getByRole('link', { name: 'Registration settings' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Registration' })).toBeVisible({ timeout: 30000 });
      await expect(management.locator('[aria-current="page"]')).toHaveText('Registration settings');
      await expect(page.getByRole('main')).toContainText('Instance');
      await expectNoHorizontalOverflow(page, `registration 1280 ${theme}`);
      await shot(page, `registration-1280-${theme}`);

      // Click 4 — back to the workspace: the tree returns, in the same pane.
      await management.getByRole('link', { name: 'Back to workspace' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });
      await expect(sidebar.getByRole('tree')).toBeVisible({ timeout: 30000 });
      await expect(sidebar.getByRole('navigation', { name: 'Management' })).toHaveCount(0);
      await expect(sidebar.getByRole('link', { name: 'Members' })).toBeVisible();
    });
  });
}

test.describe('the management doors by keyboard', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('every door is a tab stop, and Enter on one opens its screen', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);

    await page.goto(membersUrl(fixtures.workspaceSlug));
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible({ timeout: 30000 });
    // The heading and, since the read layer, the reader's denied state are
    // both server-rendered — neither says the page is hydrated. The keys
    // below need the hydrated app.
    await expect(page.getByRole('main').getByRole('status')).toContainText(/does not exist, or you do not manage it/i, { timeout: 60000 });
    await waitForHydration(page);
    const management = page.getByRole('navigation', { name: 'Management' });
    await expect(management).toBeVisible({ timeout: 30000 });

    // From the way back, Tab walks every door in reading order.
    await management.getByRole('link', { name: 'Back to workspace' }).focus();
    const visited: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      visited.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(visited).toEqual(['Members', 'Settings', 'AI & models', 'Registration settings', 'Profile']);

    await management.getByRole('link', { name: 'AI & models' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'AI & models' })).toBeVisible({ timeout: 30000 });
    await expect(management.locator('[aria-current="page"]')).toHaveText('AI & models');
  });
});

test.describe('320x900 light', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('the management region stands in the drawer, with the open door current, and nothing scrolls sideways', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, 'light');

    await page.goto(membersUrl(fixtures.workspaceSlug));
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible({ timeout: 30000 });
    // The heading and, since the read layer, the reader's denied state are
    // both server-rendered: until 2026-09-16 the denied state was the
    // client's answer and its arrival said the page was hydrated; now it
    // says nothing about the drawer toggle, which listens only once the
    // app has hydrated (docs/TODO.md Findings, 2026-09-16).
    await expect(page.getByRole('main').getByRole('status')).toContainText(/does not exist, or you do not manage it/i, { timeout: 60000 });
    await waitForHydration(page);
    await expectNoHorizontalOverflow(page, 'members 320');
    await shot(page, 'members-320-light');

    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible({ timeout: 30000 });
    const management = drawer.getByRole('navigation', { name: 'Management' });
    await expect(management).toBeVisible({ timeout: 30000 });
    await expect(drawer.getByRole('tree')).toHaveCount(0);
    await expect(management.locator('[aria-current="page"]')).toHaveText('Members');
    await drawer.evaluate((el) => Promise.allSettled(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    const drawerBox = (await drawer.boundingBox())!;
    expect(drawerBox.x, 'the drawer is flush with the left edge').toBe(0);
    expect(drawerBox.width, 'the drawer fits the viewport').toBeLessThanOrEqual(320);
    const inner = await management.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(inner.scrollWidth, `the management list scrolls sideways: ${JSON.stringify(inner)}`).toBeLessThanOrEqual(inner.clientWidth);
    await expectNoHorizontalOverflow(page, 'drawer 320');
    await shot(page, 'drawer-320-light');

    // A door closes the drawer on selection (§6) and opens its screen.
    await management.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({ timeout: 30000 });
    await expect(drawer).toBeHidden();
    await expectNoHorizontalOverflow(page, 'settings 320');
    await shot(page, 'settings-320-light');
  });
});

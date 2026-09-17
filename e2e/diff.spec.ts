import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';
import { expectNoHorizontalOverflow } from './overflow';
import { pageDiffUrl, pageHistoryUrl } from '../apps/web/app/utils/routes';
import { rememberWorkspaceCookieValue } from '../apps/web/app/utils/workspace-cookie';

/**
 * Page-level diff (block-diff spec: "Diff Reports Added, Removed,
 * Modified, And Moved"; docs/UI-CHECKLIST.md §4.7). Against the same
 * seeded `historyPageId` e2e/history.spec.ts uses — two real saves whose
 * fixture (e2e/seed.bun.ts) is built so this suite's happy path exercises
 * all four classifications from one real diff: an unchanged heading, a
 * small in-place edit (modified), a new paragraph (added), a removed
 * paragraph, and a paragraph copied byte-for-byte into a later slot
 * (moved) — verified directly against `diffBlocks()` before trusting the
 * fixture text, per the quality-bar note in tasks.md 10.3.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly historyPageId: string;
  readonly historyFirstRevisionId: string;
  readonly historySecondRevisionId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

test.describe.configure({ mode: 'serial' });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

/**
 * Navigates by clicking from the history screen, deliberately never by
 * typing the diff URL: a URL-driven test would still pass with the
 * "Compare with previous" control deleted from history.vue, which is
 * exactly the wiring this test exists to prove (task 10.3).
 */
test('a reader reaches the diff by clicking from history, and sees all four classifications distinctly', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(pageHistoryUrl(fixtures.workspaceSlug, fixtures.historyPageId));
  await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeAttached();

  const rows = page.getByRole('main').getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30000 });

  const compare = rows.nth(0).getByRole('link', { name: /compare with previous/i });
  await expect(compare).toBeVisible();
  await compare.click();

  // Generous timeout on THIS assertion specifically, not the heading below
  // it: `/diff` is a route the dev server has never compiled before this
  // click, and the on-demand compile can outlast Playwright's 5s default
  // under load — the same class of flakiness e2e/history.spec.ts already
  // documents and fixes the same way.
  await expect(page).toHaveURL(
    pageDiffUrl(fixtures.workspaceSlug, fixtures.historyPageId, {
      from: fixtures.historyFirstRevisionId,
      to: fixtures.historySecondRevisionId,
    }),
    { timeout: 30000 },
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Compare revisions' })).toBeAttached();

  // All four classifications appear, each under its own distinct label —
  // never merged into one another.
  await expect(page.getByText('A brand new paragraph about kiwis, added in this revision.')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('Added', { exact: true })).toBeVisible();
  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  await expect(page.getByText('Removed', { exact: true })).toBeVisible();
  // Directional, not a bare "Moved": the apples paragraph moves to a LATER
  // slot in the second save (block-diff spec; the badge names the
  // direction so the move reads as one without requiring the viewer to
  // compare positions themselves).
  await expect(page.getByText('Moved down', { exact: true })).toBeVisible();
  // The removed paragraph's own text is present under its own label — not
  // silently dropped.
  await expect(page.getByText('A paragraph about bananas that will be removed entirely.')).toBeVisible();
});

/**
 * An outsider cannot reach the history screen at all (it 404s for them —
 * e2e/history.spec.ts already holds that), so there is no click path onto
 * this screen to prove ITS OWN non-disclosure guard. This is the one
 * place in this suite that navigates by address, because it is the only
 * way to exercise the diff route's own `can('read')` gate independently
 * of history's.
 */
test('an outsider with no read grant sees the same not-found state a nonexistent diff would render', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(
    pageDiffUrl(fixtures.workspaceSlug, fixtures.historyPageId, {
      from: fixtures.historyFirstRevisionId,
      to: fixtures.historySecondRevisionId,
    }),
  );
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });

  const deniedHtml = await page.content();
  expect(deniedHtml).not.toContain('kiwis');
  expect(deniedHtml).not.toContain('E2E Owner');

  await page.goto(
    pageDiffUrl(fixtures.workspaceSlug, crypto.randomUUID(), {
      from: fixtures.historyFirstRevisionId,
      to: fixtures.historySecondRevisionId,
    }),
  );
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });
});

/**
 * Inside the workspace frame (docs/UI-CHECKLIST.md Review Log, 2026-09-15).
 * Measured in a real browser: the breadcrumb ending in "History › Compare"
 * with History a link back, the bar carrying "Back to history" and the two
 * revisions being compared — each a `<time>` in the viewer's zone (§4.11)
 * — and the block list on the reading measure right under the bar, with
 * no heading block between them. At 320 nothing scrolls sideways. The
 * screenshots are the owner's review material (`frame3-diff-*.png`).
 */
const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

async function shot3(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/frame3-diff-${name}.png`, fullPage: false });
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

function expectedIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(new Date(iso));
}

const DIFF_URL = pageDiffUrl(fixtures.workspaceSlug, fixtures.historyPageId, {
  from: fixtures.historyFirstRevisionId,
  to: fixtures.historySecondRevisionId,
});

/** The pane's inset from the bar to its first block (`UDashboardPanel` body `p-4 sm:p-6`). */
const PANE_INSET = 24;

/** The diff response names no workspace; the frame stands on the last one the person was in (see e2e/history.spec.ts). */
async function inWorkspace(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: 'dw-workspace',
      value: rememberWorkspaceCookieValue({ id: fixtures.workspaceId, slug: fixtures.workspaceSlug }),
      domain: 'localhost',
      path: '/',
    },
  ]);
}

/** Two viewers in two zones (§4.11): the same pair of instants reads differently in each. */
const ZONE_BY_THEME = { light: 'America/New_York', dark: 'Asia/Tokyo' } as const;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`inside the workspace frame, 1280x900 ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 }, timezoneId: ZONE_BY_THEME[theme] });

    test('the blocks stand right under the bar on the reading measure; the bar names the pair and the way back; the breadcrumb ends in History › Compare', async ({
      page,
      context,
    }) => {
      await signInAs(context, fixtures.readerSessionToken);
      await useTheme(page, theme);
      await inWorkspace(context);

      await page.goto(DIFF_URL);
      await expect(page.getByText('A brand new paragraph about kiwis, added in this revision.')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

      const sidebar = page.getByRole('navigation', { name: 'Workspace' });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole('treeitem', { name: /E2E History Page/ })).toBeVisible({ timeout: 30000 });
      await expect(sidebar.locator('[role="treeitem"][aria-current="page"]')).toHaveCount(1);

      const crumbs = page.getByRole('navigation', { name: 'Where you are' });
      await expect(crumbs.getByRole('link', { name: 'E2E History Page' })).toBeVisible();
      await expect(crumbs.getByRole('link', { name: 'History', exact: true })).toHaveAttribute(
        'href',
        pageHistoryUrl(fixtures.workspaceSlug, fixtures.historyPageId),
      );
      await expect(crumbs.getByRole('listitem').last()).toHaveText('Compare');

      const bar = page.locator('#content-bar');
      await expect(bar.getByRole('link', { name: 'Back to history' })).toBeVisible();
      // The bar holds nothing else: the breadcrumb keeps its width, and no
      // crumb is truncated to an ellipsis (measured with the pair in the
      // bar: "E2E Wor… › His… › Com…").
      await expect(bar.locator('time')).toHaveCount(0);
      for (const crumb of await crumbs.getByRole('listitem').all()) {
        const clipped = await crumb.evaluate((el) => Array.from(el.querySelectorAll('*')).some((node) => node.scrollWidth > node.clientWidth + 1));
        expect(clipped, `crumb "${await crumb.innerText()}" is not truncated`).toBe(false);
      }

      // The pair: the list's caption, from then to, each in the viewer's
      // zone with the zone named, the instant in the attribute.
      const pair = page.getByTestId('diff-pair');
      const times = pair.locator('time');
      await expect(times).toHaveCount(2);
      for (const index of [0, 1]) {
        const datetime = (await times.nth(index).getAttribute('datetime'))!;
        expect(datetime).not.toBeNull();
        await expect(times.nth(index)).toBeVisible();
        expect((await times.nth(index).innerText()).trim()).toBe(expectedIn(datetime, ZONE_BY_THEME[theme]));
        expect((await times.nth(index).innerText()).trim()).not.toMatch(/\bUTC$/);
      }
      expect(new Date((await times.nth(0).getAttribute('datetime'))!).getTime()).toBeLessThanOrEqual(
        new Date((await times.nth(1).getAttribute('datetime'))!).getTime(),
      );

      // The `<h1>` is in the tree; nothing visible repeats the crumb, so
      // the caption begins one pane inset under the bar, on one line, and
      // the first card follows it.
      await expect(page.getByRole('heading', { level: 1, name: 'Compare revisions' })).toBeAttached();
      const barBox = (await bar.boundingBox())!;
      const pairBox = (await pair.boundingBox())!;
      expect(pairBox.y - (barBox.y + barBox.height), `caption under the bar: ${pairBox.y - (barBox.y + barBox.height)}`).toBe(PANE_INSET);
      expect(pairBox.height, 'the caption is one body-small line').toBe(16);
      const firstCard = page.getByRole('main').locator('[class*="rounded-lg"]').first();
      const cardBox = (await firstCard.boundingBox())!;
      expect(cardBox.y, 'the first card follows the caption').toBeGreaterThan(pairBox.y + pairBox.height);

      const sidebarBox = (await sidebar.boundingBox())!;
      const paneLeft = sidebarBox.x + sidebarBox.width;
      expect(cardBox.width, `card width ${cardBox.width}`).toBeLessThan(720);
      expect(cardBox.width, `card width ${cardBox.width}`).toBeGreaterThan(600);
      const leftGap = cardBox.x - paneLeft;
      const rightGap = 1280 - (cardBox.x + cardBox.width);
      expect(Math.abs(leftGap - rightGap), `centred in the pane: left ${leftGap}, right ${rightGap}`).toBeLessThanOrEqual(2);

      await expectNoHorizontalOverflow(page, `diff 1280 ${theme}`);

      await shot3(page, `1280-${theme}`);
    });
  });
}

test.describe('inside the workspace frame, 320x900 light', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('the bar holds "Back to history" beside the drawer toggle and the last crumb; the pair captions the blocks; nothing scrolls sideways', async ({
    page,
    context,
  }) => {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, 'light');

    await page.goto(DIFF_URL);
    await expect(page.getByText('A brand new paragraph about kiwis, added in this revision.')).toBeVisible({ timeout: 30000 });

    const bar = page.locator('#content-bar');
    await expect(bar.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Back to history' })).toBeVisible();
    await expect(page.getByTestId('diff-pair').locator('time')).toHaveCount(2);
    const barOverflow = await bar.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(barOverflow.scrollWidth).toBeLessThanOrEqual(barOverflow.clientWidth);
    await expectNoHorizontalOverflow(page, 'diff 320');

    await shot3(page, '320-light');
  });
});

test.describe('inside the workspace frame, the skeleton', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  /**
   * docs/UI-CHECKLIST.md §3: the skeleton occupies the box the loaded
   * content will — measured, not assumed. How many blocks, and whether a
   * "removed" card comes first, only the response knows; what the skeleton
   * can hold is the caption's line and the row's box: same top for the
   * caption, same left, width and height for a row.
   */
  test('occupies the caption line and the row box', async ({ page, context }) => {
    // Waits for hydration before the hop (below): dev mode under load.
    test.setTimeout(240_000);
    await signInAs(context, fixtures.readerSessionToken);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${fixtures.apiUrl}/pages/${fixtures.historyPageId}/diff?*`, async (route) => {
      await held;
      await route.continue();
    });

    // By a client-side navigation from the history screen ("Compare with
    // previous" on the newest revision, which is this exact diff): a full
    // load is answered on the server since the data layer (`useApiRead`),
    // with no skeleton to measure — the skeleton is for a diff the browser
    // has not seen yet (see e2e/data-layer.spec.ts).
    await page.goto(pageHistoryUrl(fixtures.workspaceSlug, fixtures.historyPageId));
    await waitForHydration(page);
    await page.getByRole('link', { name: 'Compare with previous' }).first().click({ timeout: 30000 });
    await expect(page).toHaveURL(DIFF_URL);
    const skeleton = page.getByTestId('diff-skeleton');
    await expect(skeleton).toBeVisible({ timeout: 30000 });
    const skeletonCaption = (await skeleton.getByTestId('diff-skeleton-caption').boundingBox())!;
    const skeletonRow = (await skeleton.getByTestId('diff-skeleton-row').first().boundingBox())!;

    release();
    const pair = page.getByTestId('diff-pair');
    await expect(pair).toBeVisible({ timeout: 30000 });
    const loadedCaption = (await pair.boundingBox())!;
    // A row with a badge and one line of text — the shape the skeleton
    // draws — in the current revision's list.
    const loadedRow = (await page.getByRole('list', { name: /current revision/i }).locator('li').filter({ hasText: 'kiwis' }).boundingBox())!;

    expect(Math.abs(skeletonCaption.y - loadedCaption.y), `caption top: skeleton ${skeletonCaption.y}, loaded ${loadedCaption.y}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonCaption.height - loadedCaption.height), `caption height: skeleton ${skeletonCaption.height}, loaded ${loadedCaption.height}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonRow.x - loadedRow.x), `row left: skeleton ${skeletonRow.x}, loaded ${loadedRow.x}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonRow.width - loadedRow.width), `row width: skeleton ${skeletonRow.width}, loaded ${loadedRow.width}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonRow.height - loadedRow.height), `row height: skeleton ${skeletonRow.height}, loaded ${loadedRow.height}`).toBeLessThanOrEqual(1);
  });
});

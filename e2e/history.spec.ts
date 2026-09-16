import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';
import { expectNoHorizontalOverflow } from './overflow';

/**
 * Page history (revision-history spec: "Page History Query Returns
 * Revisions Newest First"; design.md "New UI screens" row 1). Against a
 * real, freshly seeded backend (e2e/global-setup.ts) — a page saved
 * twice, a page never saved, a reader who can see both, and an outsider
 * who can see neither.
 *
 * Sessions are minted directly in the seed rather than driven through the
 * sign-in UI, exactly as e2e/read.spec.ts does — this suite exercises the
 * history route, not authentication.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly historyPageId: string;
  readonly historyFirstRevisionId: string;
  readonly historySecondRevisionId: string;
  readonly emptyHistoryPageId: string;
  readonly workspaceId: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

// Serial for the same reason e2e/read.spec.ts is: these navigate to
// on-demand-compiled dev-server routes, and two simultaneous first
// compiles measured slower than one warm followed by another.
test.describe.configure({ mode: 'serial' });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

test('a reader sees every revision newest-first, with its author and changeset membership', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}/history`);

  // `<h1>Revision history</h1>` is server-rendered and in the tree
  // immediately regardless of client hydration — for assistive technology;
  // visibly the screen's identity is the breadcrumb's. The list below it is
  // not — it only exists once the client mounts, fetches, and hydrates the
  // skeleton away. The generous timeout belongs on THAT wait, not on the
  // heading: the dev server compiles this route on first visit, which under
  // load can take longer than Playwright's 5s default (see
  // e2e/read.spec.ts's identical note).
  await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeAttached();

  const rows = page.getByRole('main').getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30000 });

  // Newest first: the second save is the first row, and it has a
  // "Compare with previous" control (task 10.3: a real link to the diff
  // view) because an earlier revision exists.
  await expect(rows.nth(0)).toContainText('E2E Owner');
  await expect(rows.nth(0).getByRole('link', { name: /compare with previous/i })).toBeVisible();

  // The oldest revision — the first save — has nothing before it
  // (revision-history spec): a real state, not an edge case.
  await expect(rows.nth(1)).toContainText('E2E Owner');
  await expect(rows.nth(1)).toContainText(/initial version/i);
  await expect(rows.nth(1).getByRole('link', { name: /compare with previous/i })).toHaveCount(0);
});

/**
 * The screen is only shipped if a user can get to it.
 *
 * `/pages/:id/history` existed, was unit-tested, and had a passing e2e
 * suite above — and nothing anywhere linked to it, so it was reachable
 * only by typing the URL. Every other test in this file starts with
 * `page.goto(.../history)`, which is exactly why none of them could catch
 * that: they would all still pass with the control deleted. **These two
 * are the only tests here that fail if the affordance disappears**, so
 * they navigate the way a user does — from the read screen, by the
 * control — and never by address.
 *
 * Proven by deletion, not by assumption: with the `UTooltip`/`UButton`
 * pair removed from `apps/web/app/pages/pages/[id]/index.vue`, both fail
 * on the locator ("Revision history" resolves to nothing) while the five
 * URL-driven tests around them stay green. That asymmetry is the whole
 * point of the pair.
 */
test('the history screen is reachable from the read screen by its control, not only by its URL', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E History Page' })).toBeVisible({ timeout: 30000 });

  // By accessible name (docs/UI-CHECKLIST.md §7): the control is
  // icon-only, so the name is the entire contract — a test that reached
  // for a test id would pass on an unnamed glyph, which is the §4.3
  // failure the name exists to prevent.
  const history = page.getByRole('link', { name: 'Revision history' });
  await expect(history).toBeVisible();

  await history.click();

  await expect(page).toHaveURL(`/pages/${fixtures.historyPageId}/history`);
  await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeAttached();
  // Arrived at the history of *this* page, not merely at the route: the
  // seeded page has two revisions and the empty one has none.
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(2, { timeout: 30000 });
});

test('the history control is operable with the keyboard alone, and names itself on focus', async ({ page, context }) => {
  // Waits for hydration (below), which in dev mode under load is a
  // module waterfall well past Playwright's default 30s.
  test.setTimeout(240_000);
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E History Page' })).toBeVisible({ timeout: 30000 });
  // The heading is server-rendered; the keyboard needs the hydrated app.
  await waitForHydration(page);

  const history = page.getByRole('link', { name: 'Revision history' });
  await expect(history).toBeVisible();

  // Tabbed to, not focused programmatically: `.focus()` would pass on a
  // control with `tabindex="-1"` that no keyboard user can ever reach.
  // Since 2026-09-15 the sidebar precedes the content pane, so the frame's
  // first stop is "Skip to content"; from there the bar is breadcrumb →
  // history → Edit. The loop is bounded rather than fixed so a later
  // chrome addition fails the *assertion* below instead of this line.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  let tabs = 0;
  while (tabs < 6 && !(await history.evaluate((element) => element === document.activeElement))) {
    await page.keyboard.press('Tab');
    tabs += 1;
  }
  await expect(history).toBeFocused();
  expect(tabs, 'the history control is a few stops past the skip link, not the whole sidebar away').toBeLessThanOrEqual(4);

  // §4.3 wants both halves of an icon-only control. The accessible name
  // is asserted by the locator above; the tooltip is the other half, and
  // it must open on *focus* — a tooltip that only answers a hover is not
  // available to the keyboard user this test is standing in for.
  //
  // Asserted through `aria-describedby` rather than `getByRole('tooltip')`
  // deliberately: Reka renders the tooltip's screen-reader copy inside an
  // `aria-hidden` popper wrapper, so the default role query resolves to
  // nothing and a `getByRole('tooltip')` assertion would report the
  // tooltip missing whether it was open or not. `aria-describedby` is
  // also the actual contract — it is what carries the description to the
  // user, not the role.
  await expect(history).toHaveAttribute('data-state', /open/);
  const describedBy = await history.getAttribute('aria-describedby');
  expect(describedBy, 'focus must open the tooltip that names the glyph').not.toBeNull();
  await expect(page.locator(`#${describedBy}`)).toHaveText('Revision history');

  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(`/pages/${fixtures.historyPageId}/history`);
  await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeAttached();
});

/**
 * The owner decision of 2026-09-08: revision timestamps read in the
 * *viewer's* timezone, not UTC. Two real browsers in two real zones is
 * the only place that can be proved end to end — a unit test can force
 * `process.env.TZ`, but only this one exercises the actual SSR/hydration
 * path the change is dangerous in.
 *
 * The expected string is recomputed here from the row's own `datetime`
 * attribute with the Intl options spelled out again, deliberately rather
 * than by importing the app's formatter: a test that calls the code under
 * test to build its own expectation asserts nothing. Written out, a
 * change to the app's option set fails this test instead of being
 * silently followed.
 */
const VIEWER_ZONES = ['America/New_York', 'Asia/Tokyo'] as const;

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

test("a revision's timestamp reads in each viewer's own timezone, and hydrates without a mismatch", async ({ browser }) => {
  const rendered = new Map<string, { text: string; datetime: string }>();

  for (const timezoneId of VIEWER_ZONES) {
    const context = await browser.newContext({ timezoneId });
    await signInAs(context, fixtures.readerSessionToken);
    const page = await context.newPage();

    // Vue's dev build reports a hydration mismatch as a console warning
    // and nothing else — no thrown error, no failed assertion elsewhere —
    // so the only way to fail on one is to listen. The dev server is what
    // playwright.config.ts boots, so the dev build (and therefore this
    // warning) is present.
    const consoleMessages: string[] = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    page.on('pageerror', (error) => consoleMessages.push(error.message));

    await page.goto(`/pages/${fixtures.historyPageId}/history`);

    const timestamp = page.getByRole('main').getByRole('listitem').nth(0).locator('time');
    await expect(timestamp).toBeVisible({ timeout: 30000 });

    const datetime = await timestamp.getAttribute('datetime');
    expect(datetime, 'the machine-readable instant must survive whatever the human sees').not.toBeNull();
    const text = (await timestamp.innerText()).trim();

    expect(text).toBe(expectedIn(datetime!, timezoneId));
    // The label is the whole reason a bare local time is not ambiguous.
    expect(text).not.toMatch(/\bUTC$/);

    // Proof the console listener above is actually attached and receiving
    // — without this, "no hydration warning" would also be what a broken
    // listener reports, and this repository has shipped a check that
    // silently stopped checking before.
    await page.evaluate(() => console.debug('e2e:console-probe'));
    await expect.poll(() => consoleMessages).toContain('e2e:console-probe');
    expect(consoleMessages.filter((line) => /hydrat/i.test(line))).toEqual([]);

    rendered.set(timezoneId, { text, datetime: datetime! });
    await context.close();
  }

  const newYork = rendered.get('America/New_York')!;
  const tokyo = rendered.get('Asia/Tokyo')!;

  // Same instant, two readings. If these two ever match, the screen is
  // rendering one fixed zone again whatever the label happens to say.
  expect(newYork.datetime).toBe(tokyo.datetime);
  expect(newYork.text).not.toBe(tokyo.text);
});

// Task 10.3 wired the control that used to be inert. Following it all the
// way through — click, URL, and the diff screen's own content — is
// e2e/diff.spec.ts's job (it is the one place that exercises that route);
// this test stays scoped to history.vue's own contract: the control is a
// real, keyboard-reachable link with the correct target, not a disabled
// placeholder.
test('the compare control is a real, keyboard-operable link, not a disabled placeholder', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}/history`);

  const compare = page.getByRole('main').getByRole('listitem').nth(0).getByRole('link', { name: /compare with previous/i });
  await expect(compare).toBeVisible({ timeout: 30000 });
  await expect(compare).not.toHaveAttribute('aria-disabled', 'true');
  await expect(compare).toHaveAttribute(
    'href',
    `/pages/${fixtures.historyPageId}/diff?from=${fixtures.historyFirstRevisionId}&to=${fixtures.historySecondRevisionId}`,
  );

  await compare.focus();
  await expect(compare).toBeFocused();
});

test('a page that has never been saved shows the empty state with a path forward', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.emptyHistoryPageId}/history`);

  await expect(page.getByRole('heading', { name: /no revisions yet/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /start editing/i })).toBeVisible();
});

test('an outsider with no read grant sees the same not-found state a nonexistent page would render', async ({ page, context }) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}/history`);
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });
  // Non-disclosure: neither the page's own title nor any revision content
  // leaks into a response the viewer is not entitled to.
  const deniedHtml = await page.content();
  expect(deniedHtml).not.toContain('E2E History Page');
  expect(deniedHtml).not.toContain('E2E Owner');
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(0);

  await page.goto(`/pages/${crypto.randomUUID()}/history`);
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });
});

/**
 * docs/UI-CHECKLIST.md §3: "The skeleton occupies the same box the loaded
 * content will. Measure it; do not assume it." Measured on 2026-09-14 the
 * history skeleton rows were 64px tall against 73px loaded, and the first
 * row started 24px higher than the first loaded row — the skeleton stood
 * outside the card the list renders in. happy-dom has no layout engine,
 * so this file is the owner of that guarantee: the response is held back,
 * the skeleton is measured, the response is released, the loaded list is
 * measured, and the two boxes must agree.
 */
test('the history skeleton occupies the box the loaded list takes: same first-row top, same row height', async ({ page, context }) => {
  // Waits for hydration before the hop (below): dev mode under load.
  test.setTimeout(240_000);
  await signInAs(context, fixtures.readerSessionToken);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${fixtures.apiUrl}/pages/${fixtures.historyPageId}/history`, async (route) => {
    await held;
    await route.continue();
  });

  // By a client-side navigation from the page itself: a full load of the
  // history screen is answered on the server since the data layer
  // (`useApiRead`), with no skeleton to measure — the skeleton is for a
  // list the browser has not seen yet (see e2e/data-layer.spec.ts).
  await page.goto(`/pages/${fixtures.historyPageId}`);
  await waitForHydration(page);
  await page.getByRole('link', { name: 'Revision history' }).click({ timeout: 30000 });
  const skeletonRows = page.getByTestId('history-skeleton').locator('li');
  await expect(skeletonRows.first()).toBeVisible({ timeout: 30000 });
  const skeletonFirst = (await skeletonRows.first().boundingBox())!;
  const skeletonSecond = (await skeletonRows.nth(1).boundingBox())!;

  release();
  const rows = page.getByRole('list', { name: /revision history/i }).locator('li');
  await expect(rows.first()).toBeVisible({ timeout: 30000 });
  const loadedFirst = (await rows.first().boundingBox())!;
  const loadedSecond = (await rows.nth(1).boundingBox())!;

  expect(Math.abs(skeletonFirst.y - loadedFirst.y), `first row top: skeleton ${skeletonFirst.y}, loaded ${loadedFirst.y}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonFirst.height - loadedFirst.height), `row height: skeleton ${skeletonFirst.height}, loaded ${loadedFirst.height}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonSecond.y - loadedSecond.y), `second row top: skeleton ${skeletonSecond.y}, loaded ${loadedSecond.y}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonFirst.x - loadedFirst.x)).toBeLessThanOrEqual(1);
});

/**
 * `:ui="{ body: 'p-2' }"` replaces only the card's `p-4` and leaves its
 * `sm:p-6` standing (audit, 2026-09-14): the list was inset 8px below
 * 640px and 24px above it. Both breakpoints are now set deliberately, so
 * the row text sits 24px from the card edge at every width — the card's
 * own medium-and-up inset (docs/DESIGN-SYSTEM.md §7.4).
 */
for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 900 }] as const) {
  test(`the revision rows are inset 24px from the card edge at ${viewport.width}px`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await signInAs(context, fixtures.readerSessionToken);
    await page.goto(`/pages/${fixtures.historyPageId}/history`);
    const rows = page.getByRole('list', { name: /revision history/i }).locator('li');
    await expect(rows.first()).toBeVisible({ timeout: 30000 });

    const inset = await rows.first().evaluate((row) => {
      const card = row.closest('[class*="rounded-lg"]')!;
      const text = row.querySelector('span')!;
      return text.getBoundingClientRect().left - card.getBoundingClientRect().left;
    });
    expect(inset).toBe(24);
  });
}


/**
 * Inside the workspace frame (docs/UI-CHECKLIST.md Review Log, 2026-09-15).
 * Measured in a real browser: the tree beside the list, the breadcrumb
 * ending in the page and then "History", "Read page" as the bar's one
 * action, and — the document-frame residue gone — the list starting right
 * under the bar with no heading block between them; the `<h1>` is for the
 * accessibility tree. At 320 nothing scrolls sideways. The screenshots are
 * the owner's review material for this batch (`frame3-history-*.png`).
 */
const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

async function shot3(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/frame3-history-${name}.png`, fullPage: false });
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

/** Vertical overflow only — see e2e/overflow.ts for the horizontal check, which the document alone cannot answer inside the frame. */
function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
}

/** The pane's inset from the bar to its first block (`UDashboardPanel` body `p-4 sm:p-6`). */
const PANE_INSET = 24;

/**
 * The history response names no workspace, so the frame stands on the
 * last one the person was in — the cookie the read screen writes on the
 * way here (`useCurrentWorkspace`). A person reaches this screen from
 * that one; a fresh browser typing the address has no workspace to stand
 * on and gets the bar's trailing crumb alone.
 */
async function inWorkspace(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: 'dw-workspace', value: fixtures.workspaceId, domain: 'localhost', path: '/' }]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`inside the workspace frame, 1280x900 ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the list stands right under the bar on the reading measure, beside the tree, with the breadcrumb ending in History', async ({
      page,
      context,
    }) => {
      await signInAs(context, fixtures.readerSessionToken);
      await useTheme(page, theme);
      await inWorkspace(context);

      await page.goto(`/pages/${fixtures.historyPageId}/history`);
      const rows = page.getByRole('list', { name: /revision history/i }).locator('li');
      await expect(rows.first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

      const sidebar = page.getByRole('navigation', { name: 'Workspace' });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole('treeitem', { name: /E2E History Page/ })).toBeVisible({ timeout: 30000 });
      await expect(sidebar.locator('[role="treeitem"][aria-current="page"]')).toHaveCount(1);

      const crumbs = page.getByRole('navigation', { name: 'Where you are' });
      await expect(crumbs).toContainText('E2E Workspace');
      await expect(crumbs.getByRole('link', { name: 'E2E History Page' })).toBeVisible();
      await expect(crumbs.getByRole('listitem').last()).toHaveText('History');
      const bar = page.locator('#content-bar');
      await expect(bar.getByRole('link', { name: 'Read page' })).toBeVisible();

      // The screen's `<h1>` is in the tree, and nothing visible repeats
      // the crumb: the list's card begins one pane inset under the bar.
      await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeAttached();
      const barBox = (await bar.boundingBox())!;
      const card = page.getByRole('list', { name: /revision history/i }).locator('xpath=ancestor::*[contains(@class, "rounded-lg")][1]');
      const cardBox = (await card.boundingBox())!;
      expect(cardBox.y - (barBox.y + barBox.height), `card top under the bar: ${cardBox.y - (barBox.y + barBox.height)}`).toBe(PANE_INSET);

      // The reading measure, centred in the pane (docs/DESIGN-SYSTEM.md §2.4).
      const sidebarBox = (await sidebar.boundingBox())!;
      const paneLeft = sidebarBox.x + sidebarBox.width;
      expect(cardBox.width, `card width ${cardBox.width}`).toBeLessThan(720);
      expect(cardBox.width, `card width ${cardBox.width}`).toBeGreaterThan(600);
      const leftGap = cardBox.x - paneLeft;
      const rightGap = 1280 - (cardBox.x + cardBox.width);
      expect(Math.abs(leftGap - rightGap), `centred in the pane: left ${leftGap}, right ${rightGap}`).toBeLessThanOrEqual(2);

      const box = await overflow(page);
      await expectNoHorizontalOverflow(page, `history 1280 ${theme}`);
      expect(box.scrollHeight).toBe(box.innerHeight);

      await shot3(page, `1280-${theme}`);
    });
  });
}

test.describe('inside the workspace frame, 320x900 light', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('the bar holds "Read page" beside the drawer toggle and the last crumb; nothing scrolls sideways', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, 'light');

    await page.goto(`/pages/${fixtures.historyPageId}/history`);
    const rows = page.getByRole('list', { name: /revision history/i }).locator('li');
    await expect(rows.first()).toBeVisible({ timeout: 30000 });

    const bar = page.locator('#content-bar');
    await expect(bar.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Read page' })).toBeVisible();
    const barOverflow = await bar.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(barOverflow.scrollWidth).toBeLessThanOrEqual(barOverflow.clientWidth);
    await expectNoHorizontalOverflow(page, 'history 320');

    await shot3(page, '320-light');
  });
});

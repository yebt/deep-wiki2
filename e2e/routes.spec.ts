import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { bookHistoryUrl, membersUrl, pageHistoryUrl, pageUrl, settingsUrl, workspaceUrl } from '../apps/web/app/utils/routes';
import { waitForHydration } from './hydration';
import { expectNoHorizontalOverflow } from './overflow';

/**
 * The workspace-scoped addresses (2026-09-17), screen by screen: every
 * screen that moved under `/w/<slug>` renders at its new address with the
 * links it emits in the new shape, and nothing scrolls sideways at 320.
 * The address held to its word — the not-found a disputed slug lands on —
 * is measured here too, at every size, because it is a new screen state
 * (docs/UI-CHECKLIST.md §3, §6).
 *
 * The screenshots are the owner's review material; the assertions keep
 * them honest. `DEEPWIKI_ROUTES_SHOTS=<dir>` writes them; unset, nothing
 * is written and the suite pays nothing extra.
 */

interface Fixtures {
  readonly workspaceSlug: string;
  readonly readPageId: string;
  readonly historyPageId: string;
  readonly bookHistoryBookId: string;
  readonly readerSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const SHOTS = process.env.DEEPWIKI_ROUTES_SHOTS ?? '';

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
  await page.screenshot({ path: `${SHOTS}/fb-routes-${name}.png`, fullPage: false });
}

/**
 * Every link inside the frame carries the workspace's slug and none carries
 * an old shape. Polled: the sidebar's doors appear once the directory has
 * answered, after hydration, and the dev server may reload a first visit
 * while it optimises dependencies — a snapshot taken across either proves
 * nothing.
 */
async function expectLinksInTheNewShape(page: Page, label: string): Promise<void> {
  const hrefs = () => page.locator('a[href^="/"]').evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
  await expect
    .poll(async () => (await hrefs()).some((href) => href.startsWith(`/w/${fixtures.workspaceSlug}`)), { timeout: 30_000, message: `${label}: links carry the slug` })
    .toBe(true);
  const old = (await hrefs()).filter((href) => /^\/(pages|books)\//.test(href) || /^\/workspaces\/[0-9a-f-]{36}/.test(href));
  expect(old, `${label}: links in the old shape`).toEqual([]);
}

const SCREENS = [
  { name: 'dashboard', to: () => workspaceUrl(fixtures.workspaceSlug), ready: (page: Page) => page.getByRole('heading', { level: 1, name: 'E2E Workspace' }) },
  { name: 'read', to: () => pageUrl(fixtures.workspaceSlug, fixtures.readPageId), ready: (page: Page) => page.getByRole('heading', { level: 1, name: 'E2E Read Page' }) },
  { name: 'history', to: () => pageHistoryUrl(fixtures.workspaceSlug, fixtures.historyPageId), ready: (page: Page) => page.getByRole('main').getByRole('listitem').first() },
  { name: 'book-history', to: () => bookHistoryUrl(fixtures.workspaceSlug, fixtures.bookHistoryBookId), ready: (page: Page) => page.getByRole('main').getByRole('listitem').first() },
  { name: 'members', to: () => membersUrl(fixtures.workspaceSlug), ready: (page: Page) => page.getByRole('heading', { level: 1, name: 'Members' }) },
  { name: 'settings', to: () => settingsUrl(fixtures.workspaceSlug), ready: (page: Page) => page.getByRole('heading', { level: 1, name: 'Settings' }) },
  { name: 'not-found', to: () => pageUrl('never-minted-workspace', fixtures.readPageId), ready: (page: Page) => page.getByTestId('scope-not-found') },
] as const;

for (const { theme, width } of [
  { theme: 'light', width: 1280 },
  { theme: 'dark', width: 1280 },
  { theme: 'light', width: 320 },
] as const) {
  test.describe(`${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const screen of SCREENS) {
      test(`${screen.name} renders at its new address, links in the new shape, nothing sideways`, async ({ page, context }) => {
        await signInAs(context, fixtures.readerSessionToken);
        await useTheme(page, theme);

        await page.goto(screen.to());
        await expect(screen.ready(page)).toBeVisible({ timeout: 60_000 });
        await waitForHydration(page);
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
        if (screen.name !== 'not-found') await expectLinksInTheNewShape(page, screen.name);
        await expectNoHorizontalOverflow(page, `${screen.name} ${width} ${theme}`);
        await shot(page, `${screen.name}-${width}-${theme}`);
      });
    }
  });
}

/**
 * The address is held to its word from the screen's own response since
 * 2026-09-17: the six node responses name their workspace by id and slug
 * (`NodeWorkspaceSchema`), so no node screen asks `GET /nodes/:id/location`
 * beside its read. That request was one more per node screen — the edit
 * route's budget of 500 (`e2e/perf.spec.ts`) had measured 501 — and it
 * stays only behind the legacy redirect (`e2e/legacy-routes.spec.ts`).
 * Counted from the browser, across the load and the hydration that
 * follows it, and again across a client-side hop between two node
 * screens, where the shell is re-set up for the next screen.
 */
test.describe('no location request', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the read, history and book-history screens ask nothing at /nodes/:id/location', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    const locationRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/nodes\/[^/]+\/location(\?|$)/.test(request.url())) locationRequests.push(request.url());
    });

    for (const name of ['read', 'book-history', 'history'] as const) {
      const screen = SCREENS.find((candidate) => candidate.name === name)!;
      await page.goto(screen.to());
      await expect(screen.ready(page)).toBeVisible({ timeout: 60_000 });
      await waitForHydration(page);
      await expectLinksInTheNewShape(page, screen.name);
    }

    // A client-side hop, last: the history screen's way to the page it is about.
    const readAddress = pageUrl(fixtures.workspaceSlug, fixtures.historyPageId);
    await page.locator(`a[href="${readAddress}"]`).first().click();
    await expect(page).toHaveURL(readAddress, { timeout: 60_000 });
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
    await waitForHydration(page);

    expect(locationRequests).toEqual([]);
  });
});

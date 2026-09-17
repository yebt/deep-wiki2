import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';
import { pageUrl, workspaceUrl } from '../apps/web/app/utils/routes';

/**
 * The read layer (`apps/web/app/composables/useApiRead.ts`), against a
 * real backend: what a screen fetches, when, and what it renders from
 * memory. Before it, every screen fetched in `onMounted` — nothing was
 * server-rendered, nothing was kept between screens, and every hop
 * showed its skeleton again (docs/TODO.md, 2026-09-16, "no data layer").
 *
 * Two facts a unit test cannot hold are held here:
 *
 * 1. A full load carries the answer in the server-rendered document. The
 *    Nuxt server forwards the request's session cookie to the API — the
 *    two are different origins on the same host, `localhost:<web>` and
 *    `localhost:<api>`, and a `SameSite=Lax` cookie scoped to the bare
 *    host reaches both (see e2e/read.spec.ts's note) — so the article is
 *    HTML before any script runs, and no skeleton is ever shown.
 * 2. A screen the person comes back to renders from memory, at once, and
 *    refreshes behind the content: the browser's request is held back and
 *    the content is on screen while it is.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly readPageId: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

// Serial: every test visits the same on-demand-compiled dev-server routes
// (see e2e/read.spec.ts for why two simultaneous first compiles lose). The
// timeout covers a dev-mode first compile plus hydration under load, which
// is well past Playwright's default 30s for a test that crosses screens.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

/**
 * Holds every browser request to `url` until `release()` is called, and
 * counts them. The server's own request during a full load is not a
 * browser request and is neither held nor counted — which is exactly the
 * distinction these tests draw.
 */
async function holdRequests(page: Page, url: string): Promise<{ readonly count: () => number; readonly release: () => void }> {
  let count = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    count += 1;
    await held;
    await route.continue();
  });
  return { count: () => count, release };
}

test.describe('a full load is answered on the server', () => {
  test('the article of a page the reader may see is in the document, and the skeleton is not', async ({ context }) => {
    await signInAs(context, fixtures.readerSessionToken);

    const response = await context.request.get(pageUrl(fixtures.workspaceSlug, fixtures.readPageId), { timeout: 120_000 });
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html).toContain('<title>E2E Read Page — deep-wiki</title>');
    expect(html).toContain('Read mode serves this exact content, cached, without reparsing.');
    expect(html).not.toContain('data-testid="read-skeleton"');
  });

  test('a page the caller may not see is refused in the document too, with nothing of the page in it', async ({ context }) => {
    await signInAs(context, fixtures.outsiderSessionToken);

    const response = await context.request.get(pageUrl(fixtures.workspaceSlug, fixtures.readPageId), { timeout: 120_000 });
    expect(response.status()).toBe(200);
    const html = await response.text();

    // The apostrophe is HTML-escaped in the server's output.
    expect(html).toMatch(/You don(?:'|&#39;)t have access to this page/);
    expect(html).not.toContain('E2E Read Page');
    expect(html).not.toContain('data-testid="read-skeleton"');
  });

  test('with no session at all the server renders the skeleton and leaves the read to the browser', async ({ context }) => {
    const response = await context.request.get(pageUrl(fixtures.workspaceSlug, fixtures.readPageId), { timeout: 120_000 });
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html).toContain('data-testid="read-skeleton"');
    expect(html).not.toContain('E2E Read Page');
  });
});

test.describe('a screen the person comes back to renders from memory', () => {
  test('back to the dashboard shows the lists at once, then refreshes them behind the content', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    // The dashboard asks by the slug its address carries (`/w/<slug>`), not by id.
    const activity = await holdRequests(page, `${fixtures.apiUrl}/workspaces/${fixtures.workspaceSlug}/activity`);

    // Full load: server-rendered, so the browser never asks for the activity.
    await page.goto(workspaceUrl(fixtures.workspaceSlug));
    const lists = page.locator('[data-testid="dashboard-recent"], [data-testid="dashboard-empty"]');
    await expect(lists.first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('dashboard-skeleton')).toHaveCount(0);
    expect(activity.count()).toBe(0);

    // Into a page, then back. The row appears once the app has hydrated
    // and fetched the tree — the dev server's module waterfall, under load.
    const sidebar = page.getByRole('navigation', { name: 'Workspace' });
    await sidebar.getByRole('treeitem', { name: /E2E Read Page/ }).click({ timeout: 120_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Read Page' })).toBeVisible({ timeout: 60_000 });

    await page.goBack();

    // The lists are on screen while the refresh is still held: nothing
    // waited for the network, and no skeleton took the lists' place.
    await expect(lists.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dashboard-skeleton')).toHaveCount(0);
    await expect.poll(() => activity.count(), { timeout: 10_000 }).toBe(1);
    await expect(lists.first()).toBeVisible();
    await expect(page.getByTestId('dashboard-skeleton')).toHaveCount(0);

    activity.release();
  });

  test('back to a page shows the article at once, then refreshes it behind the content', async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    const read = await holdRequests(page, `${fixtures.apiUrl}/pages/${fixtures.readPageId}`);

    await page.goto(pageUrl(fixtures.workspaceSlug, fixtures.readPageId));
    const title = page.getByRole('heading', { level: 1, name: 'E2E Read Page' });
    await expect(title).toBeVisible({ timeout: 60_000 });
    expect(read.count()).toBe(0);
    // The article is server-rendered; the next click must be a client-side
    // hop, not a plain link's full load, so the app has to have hydrated.
    await waitForHydration(page);

    // Away to the dashboard through the breadcrumb, then back to the page.
    await page.getByRole('navigation', { name: 'Where you are' }).getByRole('link', { name: 'E2E Workspace' }).click({ timeout: 60_000 });
    await expect(page.locator('[data-testid="dashboard-recent"], [data-testid="dashboard-empty"]').first()).toBeVisible({ timeout: 60_000 });
    await page.goBack();

    await expect(title).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('read-skeleton')).toHaveCount(0);
    await expect.poll(() => read.count(), { timeout: 10_000 }).toBe(1);
    await expect(title).toBeVisible();
    await expect(page.getByTestId('read-skeleton')).toHaveCount(0);

    read.release();
  });
});

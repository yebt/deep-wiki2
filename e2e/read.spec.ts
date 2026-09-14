import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { boundaryContrast } from './contrast';

/**
 * Read mode (document-modes spec: "Read Mode Serves Pre-Rendered HTML
 * Without Reparsing"; page-content spec: "Read mode request returns
 * cached HTML"). Against a real, freshly seeded backend
 * (e2e/global-setup.ts) — a real page with real saved content, a reader
 * who can see it, and an outsider who cannot.
 *
 * Sessions are minted directly in the seed rather than driven through the
 * sign-in UI: this suite exercises the read route, not authentication
 * (e2e/auth.spec.ts's job). `localhost:<web port>` and `localhost:<api
 * port>` are different origins but the same *site* (same scheme, same
 * host, only the port differs) — a `SameSite=Lax` cookie scoped to the
 * bare `localhost` host is sent on both, exactly as it is once a real
 * sign-in sets it.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly readPageId: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

// Serial, not parallel: both tests navigate to the same on-demand-compiled
// dev-server route, and under load two simultaneous first-compiles of the
// same page were measurably slower than one followed by an already-warm
// second (see docs/TODO.md's general 4-core-under-load note).
test.describe.configure({ mode: 'serial' });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

test('a reader sees the cached content, and the response never reaches the ProseMirror/Milkdown bundle', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  const editorRequests: string[] = [];
  page.on('request', (request) => {
    if (/prosemirror|milkdown|tiptap/i.test(request.url())) editorRequests.push(request.url());
  });

  await page.goto(`/pages/${fixtures.readPageId}`);

  // A generous timeout on the first assertion only: the dev server
  // compiles this route on first visit, which under load can take longer
  // than Playwright's 5s default — everything after this is already warm.
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Read Page' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Read mode serves this exact content, cached, without reparsing.')).toBeVisible();
  expect(editorRequests).toEqual([]);
});

test('an outsider with no read grant sees a coherent permission-denied state, not a crash or an empty page', async ({ page, context }) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(`/pages/${fixtures.readPageId}`);

  await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('E2E Read Page')).toHaveCount(0);
  // No inert "Edit" link offering an action the next screen would only refuse.
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
});

/**
 * Nuxt's colour mode is class-driven (`.dark` on `<html>`, docs/DESIGN-SYSTEM.md
 * §0) and persisted under `nuxt-color-mode`; setting it before hydration
 * is what the header's toggle does, without a round trip through the UI.
 */
async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

for (const theme of ['light', 'dark'] as const) {
  // The 2026-09-14 audit measured the app bar's "Edit" at 1.09:1 against
  // the bar behind it: `variant="soft"` is `primary-container` (tone 90),
  // the bar is `bg-elevated` (tone 94), and a fill four tones from its
  // ground has no visible edge. §5 fixes the boundary of an interactive
  // control at 3:1, in every theme. A control that passes only in one is a
  // §4.2 failure as well.
  test(`the app bar's Edit control has a boundary of at least 3:1 against the bar, in the ${theme} theme`, async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, theme);

    await page.goto(`/pages/${fixtures.readPageId}`);
    const edit = page.getByRole('link', { name: 'Edit' });
    await expect(edit).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

    expect(await boundaryContrast(edit)).toBeGreaterThanOrEqual(3);
  });
}

/**
 * §3: the skeleton occupies the loaded box — measured, not assumed.
 * On 2026-09-14 the read skeleton put its first "paragraph" line 24px
 * under a 36px title (`h-9` + `mt-6`), where the loaded screen puts its
 * first paragraph 32px under the `h1` (`PageHeading`'s `mb-8`), on 26px
 * `doc-body` lines rather than 16px ones. happy-dom has no layout engine,
 * so this file is the owner: hold the response, measure, release, measure.
 */
test('the read skeleton occupies the box the loaded document takes: title and first paragraph line up', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${fixtures.apiUrl}/pages/${fixtures.readPageId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await held;
    await route.continue();
  });

  await page.goto(`/pages/${fixtures.readPageId}`);
  const skeleton = page.getByTestId('read-skeleton');
  await expect(skeleton).toBeVisible({ timeout: 30000 });
  const skeletonTitle = (await skeleton.getByTestId('read-skeleton-title').boundingBox())!;
  const skeletonLine = (await skeleton.getByTestId('read-skeleton-line').first().boundingBox())!;

  release();
  const title = page.getByRole('heading', { level: 1, name: 'E2E Read Page' });
  await expect(title).toBeVisible({ timeout: 30000 });
  const loadedTitle = (await title.boundingBox())!;
  // The article's first block, whatever the document opens with (the
  // fixture opens with an `h2`): the skeleton cannot know the shape of
  // prose it has not received, only where the prose starts and how tall a
  // body line is.
  const loadedFirstBlock = (await page.locator('article > *').first().boundingBox())!;
  const loadedParagraphLine = await page.locator('article p').first().evaluate((p) => Number.parseFloat(getComputedStyle(p).lineHeight));

  expect(Math.abs(skeletonTitle.y - loadedTitle.y), `title top: skeleton ${skeletonTitle.y}, loaded ${loadedTitle.y}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonTitle.height - loadedTitle.height), `title height: skeleton ${skeletonTitle.height}, loaded ${loadedTitle.height}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonLine.y - loadedFirstBlock.y), `first line top: skeleton ${skeletonLine.y}, loaded ${loadedFirstBlock.y}`).toBeLessThanOrEqual(1);
  // A skeleton line is one `doc-body` line box — 26px — not a 16px bar.
  expect(Math.abs(skeletonLine.height - loadedParagraphLine), `line box: skeleton ${skeletonLine.height}, prose ${loadedParagraphLine}`).toBeLessThanOrEqual(1);
});


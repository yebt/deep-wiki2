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


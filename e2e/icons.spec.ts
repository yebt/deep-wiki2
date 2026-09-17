import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';
import { workspaceUrl } from '../apps/web/app/utils/routes';

/**
 * Icons ship in the bundle. A self-hosted, possibly air-gapped product
 * must not fetch its icons at runtime — neither from its own
 * `/api/_nuxt_icon/…` endpoint (one request per screen that introduces
 * an icon, and a late pop-in with it) nor, when that is slow, from the
 * public `api.iconify.design`, which `@nuxt/icon` falls back to unless
 * told not to (`fallbackToApi`). `nuxt.config.ts`'s `icon` block bundles
 * every icon the app's templates name (`clientBundle.scan`) and turns the
 * fallback off; this is the proof, across the four screens a writer
 * crosses most: dashboard → page → edit → page again.
 */

interface SeedFixtures {
  readonly apiUrl: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
}

interface EditorFixtures {
  readonly writerSessionToken: string;
  readonly editablePageId: string;
  readonly editablePageTitle: string;
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');

let editorFixtures: EditorFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  editorFixtures = JSON.parse(output.trim().split('\n').pop()!);
});

async function signIn(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

test('no icon is fetched at runtime, from this server or from Iconify, across dashboard → page → edit → page', async ({ page }) => {
  // Four screens, each compiled on demand by the dev server on its first
  // visit and hydrated through a dev-mode module waterfall: under load,
  // well past Playwright's default 30s for the whole test.
  test.setTimeout(360_000);
  await signIn(page, editorFixtures.writerSessionToken);

  const iconRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('api.iconify.design') || url.includes('/api/_nuxt_icon/')) iconRequests.push(url);
  });

  await page.goto(workspaceUrl(seed.workspaceSlug));
  await expect(page.locator('[data-testid="dashboard-recent"], [data-testid="dashboard-empty"]').first()).toBeVisible({ timeout: 60_000 });
  // The dashboard is server-rendered; the hops below are client-side, so
  // the app has to have hydrated first.
  await waitForHydration(page, 180_000);

  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  await sidebar.getByRole('treeitem', { name: new RegExp(editorFixtures.editablePageTitle) }).click({ timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1, name: editorFixtures.editablePageTitle })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('link', { name: /^Edit/ }).click({ timeout: 60_000 });
  await expect(page.getByTestId('editor-surface')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('link', { name: 'Read page' }).click({ timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1, name: editorFixtures.editablePageTitle })).toBeVisible({ timeout: 60_000 });

  // The screens' icons are on screen — the toolbar, the tree, the badges —
  // so a request for any of them would have been made by now.
  await expect(page.getByRole('link', { name: /^Edit/ })).toBeVisible();
  expect(iconRequests).toEqual([]);
});

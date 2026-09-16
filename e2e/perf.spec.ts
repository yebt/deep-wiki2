import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_URL } from './ports';

/**
 * Edit-mode latency, measured in the browser the way the 2026-09-16
 * performance report measured it (docs/TODO.md Findings, "edit-mode
 * latency: measured causes and fixes"). Each test here pins one of the
 * report's fixes to the observable it was proved by, against the real
 * backend and this repository's own dev server — the mode the owner runs.
 *
 * These tests count requests and watch their order. docs/UI-CHECKLIST.md
 * §7 forbids request-count assertions on *screens*, because a screen's
 * contract is what a person sees; this file is not a screen contract. It
 * is the regression guard for a measured cause — a 1,030-request
 * waterfall, an import awaited after the response it could have overlapped
 * — where the request is the observable, and the only honest one.
 */

// Serial: two simultaneous first-compiles of the same dev-server route
// measurably slow each other down (e2e/editor.spec.ts's note), and the
// request counts below are per-navigation facts that a parallel worker
// warming the same module graph would blur.
test.describe.configure({ mode: 'serial' });

interface SeedFixtures {
  readonly workspaceId: string;
}

interface EditorFixtures {
  readonly writerSessionToken: string;
  readonly editablePageId: string;
  readonly editablePageTitle: string;
  readonly editablePageMarkdown: string;
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');

let fixtures: EditorFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  fixtures = JSON.parse(output.trim().split('\n').pop()!);
});

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

/** The editor is live: ProseMirror has attached and the seeded text is in the document. */
async function expectEditorLive(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-surface')).toContainText(fixtures.editablePageMarkdown.trim(), { timeout: 120_000 });
}

/** The `"./mount"` entry of packages/editor, as the dev server names it. */
const MOUNT_CHUNK = /packages\/editor\/src\/mount\/index\.ts/;

/**
 * Fix A — prebundle reka-ui (apps/web/modules/perf-prebundle.ts).
 *
 * Measured on main at 4987cd9: 1027–1033 resources before the edit
 * screen was editable, 565 of them reka-ui modules served one by one.
 * With the package prebundled: 432. The buffer must be raised before
 * navigation — the browser keeps 250 resource entries by default and
 * silently drops the rest, which would make the waterfall *pass* this
 * assertion.
 */
test('the edit route loads in fewer than 500 requests: reka-ui is prebundled, not served file by file', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);
  await page.addInitScript(() => performance.setResourceTimingBufferSize(20_000));

  // Once, so the count below is a steady-state load of the route and not
  // the dev server's first compile of it — on a cold optimizer cache Vite
  // discovers the editor's dependencies mid-navigation and reloads.
  await page.goto(`/pages/${fixtures.editablePageId}/edit`);
  await expectEditorLive(page);

  await page.goto(`/pages/${fixtures.editablePageId}/edit`);
  await expectEditorLive(page);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  const rekaUi = resources.filter((name) => name.includes('reka-ui')).length;

  expect(resources.length, `${resources.length} resources, ${rekaUi} of them reka-ui`).toBeLessThan(500);
});

/**
 * Fix C — the edit chain is parallel, not serial.
 *
 * On main the mount chunk (`@deep-wiki/editor/mount`) was imported by
 * `EditorSurface` *after* the edit-session response arrived, so the two
 * longest waits of the open ran one after the other. The session is held
 * here until the chunk request has been seen — or for long enough to be
 * sure it never comes — so the order is what is asserted, not a timing.
 */
test('the editor chunk is requested while the edit-session request is still in flight', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, fixtures.writerSessionToken);

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API_URL}/pages/${fixtures.editablePageId}/edit-session`, async (route) => {
    await held;
    await route.continue();
  });
  const mountRequestedAt: number[] = [];
  page.on('request', (request) => {
    if (MOUNT_CHUNK.test(request.url())) mountRequestedAt.push(Date.now());
  });

  await page.goto(`/pages/${fixtures.editablePageId}/edit`);
  await expect(page.getByTestId('edit-skeleton')).toBeVisible({ timeout: 120_000 });
  // The session is still held. The chunk must be on the wire already.
  await expect
    .poll(() => mountRequestedAt.length, {
      timeout: 60_000,
      message: 'the editor chunk was never requested while the edit-session response was held back',
    })
    .toBeGreaterThan(0);
  const releasedAt = Date.now();
  release();

  await expectEditorLive(page);
  expect(mountRequestedAt[0]!, 'the chunk request preceded the session response').toBeLessThan(releasedAt);
});

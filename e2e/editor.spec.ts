import { expect, test, type Page } from '@playwright/test';
import { API_URL } from './ports';

/**
 * Edit mode (document-editor spec: live preview renders in place;
 * document-modes spec: "Take Over" And "Open Read-Only" Are Always Both
 * Offered). Unlike e2e/read.spec.ts, this suite mocks the API at the
 * network boundary (`page.route`) rather than seeding a real backend:
 * the scenarios here are about the EDITOR's own behaviour (live preview,
 * lock-contention chrome), not about permission resolution, which
 * apps/api's route tests (routes/pages.test.ts) and e2e/read.spec.ts's
 * real-backend pattern already cover. A session cookie is still set so
 * the page's own auth-adjacent chrome renders normally; its value is
 * never checked by these mocked routes.
 *
 * Real-backend verification for edit mode: apps/api/src/routes/pages.test.ts
 * (13 tests, includes edit-session/lock/take-over behind can()). Browser
 * rendering (live preview, keyboard-first menus, lock-contention chrome,
 * refusal UI) was additionally verified manually against this exact dev
 * server with a throwaway screenshot harness — see the WU-16 commit
 * message and the UI review brief for what was captured.
 */

// Serial, not parallel — see e2e/read.spec.ts's identical note: two
// simultaneous first-compiles of the same dev-server route measurably
// slowed each other down under this session's shared 4-core load.
test.describe.configure({ mode: 'serial' });

const PAGE_ID = '33333333-3333-3333-3333-333333333333';

/**
 * `API_URL` (e2e/ports.ts) is the same per-worktree-derived address
 * `playwright.config.ts` passes to the dev server as
 * `NUXT_PUBLIC_API_BASE_URL` — hardcoding `localhost:3000` here worked
 * only for the main checkout's default port and silently pointed every
 * mock at the wrong origin in a worktree, where the harness picks a
 * different port per checkout so several worktrees can run e2e at once.
 * The real global-setup-started `apps/api` still answers on that same
 * port for any request these mocks do not intercept (there is no
 * conflict — every route below is intercepted before it reaches it).
 */
function apiOrigin(): string {
  return API_URL;
}

async function signIn(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: 'session', value: 'e2e-editor-spec-token', domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

test('typing markdown syntax renders the formatted result inline, with no separate preview pane', async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page);
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        markdown: 'Start.\n',
        title: 'Live Preview Test',
        workspaceId: 'ws-e2e',
        lock: { holderUserId: 'me', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
      }),
    }),
  );
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );

  await page.goto(`/pages/${PAGE_ID}/edit`);

  const editor = page.getByTestId('editor-surface');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' **bold**');

  // The formatted result renders inline, at the cursor, inside the one
  // editable surface — there is no second preview pane anywhere on the
  // page to render into (document-editor: "Live Preview Renders In
  // Place").
  await expect(editor.locator('strong')).toHaveText('bold');
  await expect(page.locator('[data-testid]:not([data-testid="editor-surface"]) strong')).toHaveCount(0);
});

test('entering edit mode while another holder is active offers both "Take over" and "Open read-only" before the editor opens', async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page);
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        reason: 'locked',
        holder: { userId: 'other-user', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
        offeredExits: ['read_only', 'take_over'],
      }),
    }),
  );

  await page.goto(`/pages/${PAGE_ID}/edit`);

  await expect(page.getByRole('heading', { name: 'Someone else is editing this page' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('link', { name: 'Open read-only' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take over editing' })).toBeVisible();
  // Neither the editor surface nor its dynamic import ran — the refusal
  // is resolved before the editor ever opens.
  await expect(page.getByTestId('editor-surface')).toHaveCount(0);

  // Take over states its consequence before it is confirmed
  // (docs/UI-CHECKLIST.md §4.8) — a confirmation dialog, not an
  // immediate action.
  await page.getByRole('button', { name: 'Take over editing' }).click();
  await expect(page.getByText(/will lose the ability to save/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take over', exact: true })).toBeVisible();
});

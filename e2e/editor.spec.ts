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
  // The surface's box is in the DOM before ProseMirror has mounted a
  // document into it, and keystrokes sent in that window land nowhere at
  // all — which is how this test failed under a full-suite run on four
  // cores while passing every time it ran alone. The seeded content is the
  // observable proof that the editor is live, so wait for it rather than
  // for a longer timeout on the assertion three lines down, which would
  // have been waiting for a keystroke that was never delivered.
  await expect(editor).toContainText('Start.', { timeout: 30000 });
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

// The gap this task closes (docs/TODO.md Finding, reported alongside this
// commit): `useSavePage` has exposed `canonical` on a `not canonical` 409
// since before this task, and edit.vue never rendered it — the
// not-canonical 409 had no UI at all. Same pattern as the dead-anchor
// banner: `role="alert"`, the message, and an action that loads the
// offered document back into the editor via the same remount-key trick.
test('a save refused as "not canonical" offers the canonical document back, and loading it lets the retry succeed', async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page);
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        markdown: 'Not canonical yet.\n',
        title: 'Not Canonical Test',
        workspaceId: 'ws-e2e',
        lock: { holderUserId: 'me', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
      }),
    }),
  );
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );

  let saveAttempts = 0;
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}`, (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    saveAttempts += 1;
    if (saveAttempts === 1) {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not canonical', canonical: 'Canonicalised by the server.\n' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contentHash: 'hash-2' }) });
  });

  await page.goto(`/pages/${PAGE_ID}/edit`);
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toContainText('Not canonical', { timeout: 30000 });
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');

  await page.getByRole('button', { name: /Save/ }).click();

  const banner = page.getByRole('alert').filter({ hasText: /canonical form/i });
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use the canonical document' })).toBeVisible();

  await page.getByRole('button', { name: 'Use the canonical document' }).click();
  await expect(editor).toContainText('Canonicalised by the server.');

  // The buffer is dirty again after loading the offered document (the
  // same "retry, not stuck" contract dead-anchor's exit has) — saving
  // again must be possible, and this time the mock succeeds.
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
  expect(saveAttempts).toBe(2);
});

// Measured by the 2026-09-14 audit: clicking the second candidate of either
// menu left the text unchanged, the menu open and the editor unfocused —
// the plugins handle Enter and leave the click to the host, and no host
// wired it (docs/UI-CHECKLIST.md §6, "no inert interactions"). The unit
// suite proves the wiring against a fake view; this proves a real pointer
// on a real ProseMirror document produces the block and keeps the caret.
test('clicking the second slash command runs it, closes the menu and leaves the editor focused', async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page);
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        markdown: 'Start.\n',
        title: 'Slash Click Test',
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
  await expect(editor).toContainText('Start.', { timeout: 30000 });
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');

  const menu = page.getByRole('listbox', { name: 'Block commands' });
  await expect(menu).toBeVisible();
  // The textbox says which listbox it drives, and that listbox owns the
  // options (checklist §5).
  await expect(editor).toHaveAttribute('aria-expanded', 'true');
  await expect(editor).toHaveAttribute('aria-controls', (await menu.getAttribute('id'))!);
  const second = menu.getByRole('option').nth(1);
  await expect(second).toHaveText(/Heading 2/);

  await second.click();

  await expect(menu).toHaveCount(0);
  await expect(editor.locator('h2')).toHaveCount(1);
  await expect(editor).toBeFocused();
  // The caret is inside the new block: typing lands in the heading.
  await page.keyboard.type('Second');
  await expect(editor.locator('h2')).toHaveText('Second');
});


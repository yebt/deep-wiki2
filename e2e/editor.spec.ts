import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '../apps/web/app/composables/useLockHeartbeat';
import { API_URL } from './ports';
import { expectNoHorizontalOverflow } from './overflow';

/**
 * Edit mode (document-editor spec: live preview renders in place;
 * document-modes spec: "Take Over" And "Open Read-Only" Are Always Both
 * Offered). Unlike e2e/read.spec.ts, most of this suite mocks the API at
 * the network boundary (`page.route`) rather than seeding a real backend:
 * the scenarios here are about the EDITOR's own behaviour (live preview,
 * lock-contention chrome), not about permission resolution, which
 * apps/api's route tests (routes/pages.test.ts) and e2e/read.spec.ts's
 * real-backend pattern already cover. A session cookie is still set so
 * the page's own auth-adjacent chrome renders normally; its value is
 * never checked by these mocked routes.
 *
 * The one exception is the real-backend Save test below: mocking
 * `GET /pages/:id/edit-session` and `PUT /pages/:id` is exactly what let
 * the edit screen ship unable to save any page that already had content
 * (docs/TODO.md Finding, this task) — every mock here answered
 * `expectedContentHash` requests the same way regardless of what the
 * client actually sent, which a fake server can do and a real one cannot.
 * That test drives both routes for real, against a page seeded with real
 * content, the same way e2e/read.spec.ts and e2e/comments.spec.ts do.
 *
 * Real-backend verification for edit mode: apps/api/src/routes/pages.test.ts
 * (includes edit-session/lock/take-over behind can()) and the real-backend
 * Save test below. Browser rendering (live preview, keyboard-first menus,
 * lock-contention chrome, refusal UI) was additionally verified manually
 * against this exact dev server with a throwaway screenshot harness — see
 * the WU-16 commit message and the UI review brief for what was captured.
 */

// Serial, not parallel — see e2e/read.spec.ts's identical note: two
// simultaneous first-compiles of the same dev-server route measurably
// slowed each other down under this session's shared 4-core load.
test.describe.configure({ mode: 'serial' });

const PAGE_ID = '33333333-3333-3333-3333-333333333333';

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

let editorFixtures: EditorFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  editorFixtures = JSON.parse(output.trim().split('\n').pop()!);
});

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

/**
 * A fake session for the mocked-route tests. The real `apps/api` behind
 * the mocks answers this token with 401 on every route a test did not
 * intercept — the frame's own `GET /workspaces` and the tree — and since
 * 2026-09-16 a 401 anywhere is the signed-out rule: the screen leaves for
 * sign-in (`useSignInRedirect`). So the frame's requests are answered
 * here as a signed-in caller who can read nothing: an empty directory and
 * a refused tree. A test that wants the frame for real signs in with a
 * seeded token (`signInAs`).
 */
async function signIn(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: 'session', value: 'e2e-editor-spec-token', domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
  await page.route(`${apiOrigin()}/workspaces`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspaces: [] }) }),
  );
  await page.route(`${apiOrigin()}/workspaces/*/tree`, (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) }),
  );
}

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

// The regression test: real edit-session, real Save, real backend — no
// `page.route` anywhere in it. Before this task, `GET /pages/:id/edit-session`
// carried no `contentHash`, so this exact flow, against this exact
// already-saved fixture, 409'd on the first Save with "Someone else saved a
// newer version" (docs/TODO.md Finding, this task).
test('saving an already-saved page persists the edit and reads back for real, with no mocked route', async ({ page }) => {
  test.setTimeout(60000);
  await signInAs(page, editorFixtures.writerSessionToken);

  await page.goto(`/pages/${editorFixtures.editablePageId}/edit`);
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Edited for real, through the real backend.');

  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 30000 });

  // The saved markdown came back: reload triggers a fresh, real
  // `GET /pages/:id/edit-session`, so this is what the row actually holds,
  // not what the tab optimistically kept in memory.
  await page.reload();
  const editorAfterReload = page.getByTestId('editor-surface');
  await expect(editorAfterReload).toBeVisible({ timeout: 30000 });
  await expect(editorAfterReload).toContainText('Edited for real, through the real backend.', { timeout: 30000 });
});

/**
 * docs/UI-CHECKLIST.md §4.5: "Leaving edit mode with unsaved changes
 * prompts." Since 2026-09-16 the prompt is the product's own dialog
 * (`ConfirmDialog` through `useConfirm`), not `window.confirm`: driven
 * here through the transition a person actually makes — a click on a
 * tree row beside the editor — against the real backend. Cancel keeps
 * the editor with its edits; confirm leaves. (A tab closing is the
 * browser's own `beforeunload` prompt and cannot be driven from here.)
 */
test('leaving a dirty editor by clicking a tree row asks in the product\'s dialog: cancel keeps the editor and its edits, confirm leaves', async ({ page }) => {
  test.setTimeout(90000);
  await signInAs(page, editorFixtures.writerSessionToken);

  await page.goto(`/pages/${editorFixtures.editablePageId}/edit`);
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
  // The writer can read one page — this one — so its own row is the tree
  // row to click: from `/edit` it opens the page for reading, a route
  // change the guard sees like any other.
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  const otherRow = sidebar.getByRole('treeitem', { name: new RegExp(editorFixtures.editablePageTitle) });
  await expect(otherRow).toBeVisible({ timeout: 30000 });

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Not saved yet.');
  await expect(editor).toContainText('Not saved yet.');
  // The editor reports its document 300ms after the last keystroke
  // (`EditorSurface`); Save enabling is the screen's own word that the
  // buffer is dirty, and the guard reads the same flag.
  await expect(page.locator('#content-bar').getByRole('button', { name: /^Save/ })).not.toHaveAttribute('aria-disabled');

  // Escape is one exit (§5); Cancel is the other. Both keep the editor.
  await otherRow.getByText(editorFixtures.editablePageTitle).click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/unsaved changes in this tab will be lost/i);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/pages/${editorFixtures.editablePageId}/edit$`));
  await expect(editor).toContainText('Not saved yet.');

  await otherRow.getByText(editorFixtures.editablePageTitle).click();
  await expect(dialog).toBeVisible();
  await shotShell(page, 'edit-confirm-1280-light');
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/pages/${editorFixtures.editablePageId}/edit$`));
  await expect(editor).toContainText('Not saved yet.');
  // Focus came back to the control that asked (§5).
  await expect(otherRow).toBeFocused();

  await otherRow.getByText(editorFixtures.editablePageTitle).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${editorFixtures.editablePageId}$`), { timeout: 30000 });
  await expect(page.locator('article')).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
});

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

/** A mocked, editable session for the block-UI tests: the editor opens on `markdown` with nothing else on the wire. */
async function openMockedEditor(page: Page, markdown: string, title = 'Block UI Test'): Promise<ReturnType<Page['getByTestId']>> {
  await signIn(page);
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        markdown,
        title,
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
  return editor;
}

/**
 * Undo and Redo in the contextual bar (docs/TODO.md Findings 2026-09-16,
 * "the `/mount` API"): named, tooltipped with their keys, `aria-disabled`
 * with a reason until there is history on that side, and acting through
 * the same commands `Ctrl+Z` runs inside the editor — so a button press
 * and the keystroke agree on what one step is.
 */
test('Undo and Redo stand beside Save: disabled with a reason until there is history, undo takes the edit back and redo restores it', async ({ page }) => {
  test.setTimeout(60000);
  const editor = await openMockedEditor(page, 'Start.\n');
  await expect(editor).toContainText('Start.', { timeout: 30000 });
  const bar = page.locator('#content-bar');
  const undo = bar.getByRole('button', { name: 'Undo' });
  const redo = bar.getByRole('button', { name: 'Redo' });
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await expect(redo).toHaveAttribute('aria-disabled', 'true');
  // The reason and the keys are in the tooltip, which opens on focus as
  // on hover and names itself in `aria-describedby` (§3, §4.3, §5).
  await undo.focus();
  const describedBy = await undo.getAttribute('aria-describedby');
  expect(describedBy, 'focus must open the tooltip').not.toBeNull();
  await expect(page.locator(`#${describedBy}`)).toContainText(/nothing to undo/i);
  await expect(page.locator(`#${describedBy}`)).toContainText('Z');
  await expect(undo).toHaveAttribute('aria-keyshortcuts', /Z$/);

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Then more.');
  await expect(editor).toContainText('Start. Then more.');
  await expect(undo).not.toHaveAttribute('aria-disabled');

  await undo.click();
  await expect(editor).not.toContainText('Then more.');
  await expect(redo).not.toHaveAttribute('aria-disabled');
  // The caret stayed in the document: the next keys land there, not on the button.
  await expect(editor).toBeFocused();

  await redo.click();
  await expect(editor).toContainText('Start. Then more.');
  await expect(redo).toHaveAttribute('aria-disabled', 'true');
});

/**
 * Inside the workspace frame (docs/UI-CHECKLIST.md Review Log, 2026-09-15:
 * every screen opts into `layouts/workspace.vue`; the owner's pass on the
 * frame). Measured in a real browser, because happy-dom has no layout
 * engine: the editor stands on the column read mode stands on — to the
 * pixel, closing the 16px step the 2026-09-07 review recorded — the
 * breadcrumb ends in the page and the "Editing" state, this screen's
 * actions are in the contextual bar, the skeleton is the editor's own box,
 * focus mode works with a live editor under it, and at 320 the bar holds
 * with the lock-lost notice in the pane rather than in it.
 *
 * The screenshots are the owner's review material for this batch
 * (`frame3-edit-*.png`); the assertions are what keeps them honest.
 */
const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

async function shot3(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/frame3-edit-${name}.png`, fullPage: false });
}

/** The 2026-09-16 batch's review material: the condensed bar, the toolbar row, the confirm dialog. */
async function shotShell(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-shell-${name}.png`, fullPage: false });
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

for (const theme of ['light', 'dark'] as const) {
  test.describe(`inside the workspace frame, 1280x900 ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the editor takes the column read mode takes, under the same title, with the tree beside it and Editing in the breadcrumb', async ({ page }) => {
      test.setTimeout(90000);
      await signInAs(page, editorFixtures.writerSessionToken);
      await useTheme(page, theme);

      // Read mode first: where the title and the first paragraph stand.
      await page.goto(`/pages/${editorFixtures.editablePageId}`);
      const readTitle = page.getByRole('heading', { level: 1, name: editorFixtures.editablePageTitle });
      await expect(readTitle).toBeVisible({ timeout: 30000 });
      const readTitleBox = (await readTitle.boundingBox())!;
      const readParagraph = (await page.locator('article > p').first().boundingBox())!;

      // Edit mode, by the control read mode offers — the transition a
      // person actually makes (docs/UI-CHECKLIST.md §4.5).
      await page.getByRole('link', { name: 'Edit', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/pages/${editorFixtures.editablePageId}/edit$`));
      const editor = page.getByTestId('editor-surface');
      await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

      // The room did not change: the same sidebar, marking this page.
      const sidebar = page.getByRole('navigation', { name: 'Workspace' });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.locator('[role="treeitem"][aria-current="page"]')).toHaveCount(1);

      // The contextual bar: where the person is, ending in the state, then
      // what they can do.
      const crumbs = page.getByRole('navigation', { name: 'Where you are' });
      await expect(crumbs).toContainText(editorFixtures.editablePageTitle);
      await expect(crumbs.getByRole('listitem').last()).toHaveText('Editing');
      const bar = page.locator('#content-bar');
      await expect(bar.getByRole('link', { name: 'Read page' })).toBeVisible();
      await expect(bar.getByRole('button', { name: /^Save/ })).toBeVisible();

      // The condensed bar (2026-09-16): the page and its state are the
      // only crumbs drawn; the path above them — here the workspace — is
      // one activation away behind an overflow control, and the bar keeps
      // the height every other screen's bar has.
      await expect(crumbs).not.toContainText('E2E Workspace');
      const overflowControl = crumbs.getByRole('button', { name: 'Show the full path' });
      await expect(overflowControl).toBeVisible();
      // The review shot, before the interactions below leave a control focused.
      await shotShell(page, `edit-1280-${theme}`);
      await overflowControl.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menu')).toContainText('E2E Workspace');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      const barBox = (await bar.boundingBox())!;
      expect(Math.round(barBox.height), `bar height ${barBox.height}`).toBe(56);
      // Save is the one filled action; "Read page" is a Text button.
      const saveClass = await bar.getByRole('button', { name: /^Save/ }).getAttribute('class');
      const readClass = await bar.getByRole('link', { name: 'Read page' }).getAttribute('class');
      expect(saveClass).toMatch(/(^|\s)bg-primary(\s|$)/);
      // No fill at rest — a `hover:bg-*` state layer is not a fill.
      expect(readClass).not.toMatch(/(^|\s)bg-/);
      // Focus mode's keys are stated on its control: the tooltip opens on
      // focus as on hover, and carries the name and the keys. Asserted
      // through `aria-describedby`, as `e2e/history.spec.ts` does — Reka's
      // `role="tooltip"` copy sits inside an `aria-hidden` wrapper.
      const toggle = bar.getByRole('button', { name: 'Hide sidebar' });
      await toggle.focus();
      await expect(toggle).toHaveAttribute('data-state', /open/);
      const describedBy = await toggle.getAttribute('aria-describedby');
      expect(describedBy, 'focus must open the tooltip').not.toBeNull();
      await expect(page.locator(`#${describedBy}`)).toContainText('Hide sidebar');
      await expect(page.locator(`#${describedBy}`)).toContainText('\\');
      await page.keyboard.press('Escape');

      // The sidebar's toolbar row fills the pane: New… grows, Rename…
      // keeps its natural width, and nothing is left empty to the right.
      const createBox = (await sidebar.getByTestId('tree-create-open').boundingBox())!;
      const renameBox = (await sidebar.getByTestId('tree-rename-open').boundingBox())!;
      const rowBox = (await sidebar.getByTestId('tree-create-open').locator('..').boundingBox())!;
      expect(createBox.width, 'New… grows past its natural width').toBeGreaterThan(renameBox.width);
      expect(Math.abs(renameBox.x + renameBox.width - (rowBox.x + rowBox.width)), 'Rename… ends at the row\'s edge').toBeLessThanOrEqual(1);
      expect(Math.round(createBox.height)).toBe(32);
      expect(Math.round(renameBox.height)).toBe(32);

      // The same title in the same box, and the prose on the same column:
      // the text does not move under the cursor when the mode changes.
      const editTitle = page.getByRole('main').getByRole('heading', { level: 1, name: editorFixtures.editablePageTitle });
      await expect(editTitle).toBeVisible();
      const editTitleBox = (await editTitle.boundingBox())!;
      const editParagraph = (await editor.locator(':scope > p').first().boundingBox())!;
      expect(Math.abs(editTitleBox.x - readTitleBox.x), `title x: read ${readTitleBox.x}, edit ${editTitleBox.x}`).toBeLessThanOrEqual(1);
      expect(Math.abs(editTitleBox.y - readTitleBox.y), `title y: read ${readTitleBox.y}, edit ${editTitleBox.y}`).toBeLessThanOrEqual(1);
      expect(Math.abs(editTitleBox.width - readTitleBox.width), `title width: read ${readTitleBox.width}, edit ${editTitleBox.width}`).toBeLessThanOrEqual(1);
      expect(Math.abs(editParagraph.x - readParagraph.x), `paragraph x: read ${readParagraph.x}, edit ${editParagraph.x}`).toBeLessThanOrEqual(1);
      expect(Math.abs(editParagraph.width - readParagraph.width), `paragraph width: read ${readParagraph.width}, edit ${editParagraph.width}`).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs(editParagraph.y - readParagraph.y), `paragraph y: read ${readParagraph.y}, edit ${editParagraph.y}`).toBeLessThanOrEqual(1);

      const box = await overflow(page);
      await expectNoHorizontalOverflow(page, `editor 1280 ${theme}`);
      expect(box.scrollHeight).toBe(box.innerHeight);

      await shot3(page, `1280-${theme}`);
    });
  });
}

test.describe('inside the workspace frame, focus mode', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  // The frame's focus mode, proved on this route: an editor with a
  // sidebar is where people reach for it, and the proof is that the
  // editor is still live afterwards — the keys typed after the collapse
  // land in the document and make it saveable.
  test('Ctrl+\\ hides the sidebar, the editor re-centres at its width, and typing still lands in it', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'light');

    await page.goto(`/pages/${editorFixtures.editablePageId}/edit`);
    const editor = page.getByTestId('editor-surface');
    await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
    const sidebar = page.getByRole('navigation', { name: 'Workspace' });
    await expect(sidebar).toBeVisible();
    const before = (await editor.boundingBox())!;
    const save = page.getByRole('button', { name: /^Save/ });
    await expect(save).toHaveAttribute('aria-disabled', 'true');

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+\\');

    await expect(sidebar).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
    const bar = (await page.locator('#content-bar').boundingBox())!;
    expect(bar.x, 'no rail: the pane starts at the viewport edge').toBe(0);
    const after = (await editor.boundingBox())!;
    expect(Math.abs(after.width - before.width), `editor width ${before.width} → ${after.width}`).toBeLessThanOrEqual(1);
    const leftGap = after.x;
    const rightGap = 1280 - (after.x + after.width);
    expect(Math.abs(leftGap - rightGap), `centred in the viewport: left ${leftGap}, right ${rightGap}`).toBeLessThanOrEqual(2);

    // Still an editor: the next keys are content, and Save wakes up.
    await page.keyboard.type(' Typed with the sidebar hidden.');
    await expect(editor).toContainText('Typed with the sidebar hidden.');
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');

    await shot3(page, 'focus-1280-light');

    await page.keyboard.press('Control+\\');
    await expect(sidebar).toBeVisible();
    await expect(editor).toContainText('Typed with the sidebar hidden.');
  });
});

test.describe('inside the workspace frame, the skeleton', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  /**
   * docs/UI-CHECKLIST.md §3: the skeleton occupies the box the loaded
   * content will — measured, not assumed. The response is held back, the
   * skeleton's title and first line are measured, the response is
   * released, and the title and the editor's first paragraph are measured
   * where they land: same tops, same lefts, same widths, and a line that
   * is one `doc-body` line box.
   */
  test('occupies the title line and the editor\'s first text line: same tops, same lefts, same widths', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${apiOrigin()}/pages/${editorFixtures.editablePageId}/edit-session`, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto(`/pages/${editorFixtures.editablePageId}/edit`);
    const skeleton = page.getByTestId('edit-skeleton');
    await expect(skeleton).toBeVisible({ timeout: 30000 });
    const skeletonTitle = (await skeleton.getByTestId('edit-skeleton-title').boundingBox())!;
    const skeletonLine = (await skeleton.getByTestId('edit-skeleton-line').first().boundingBox())!;

    release();
    const title = page.getByRole('main').getByRole('heading', { level: 1, name: editorFixtures.editablePageTitle });
    await expect(title).toBeVisible({ timeout: 30000 });
    const editor = page.getByTestId('editor-surface');
    await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
    const loadedTitle = (await title.boundingBox())!;
    const firstParagraph = editor.locator(':scope > p').first();
    const loadedLine = (await firstParagraph.boundingBox())!;
    const loadedLineHeight = await firstParagraph.evaluate((p) => Number.parseFloat(getComputedStyle(p).lineHeight));

    expect(Math.abs(skeletonTitle.y - loadedTitle.y), `title top: skeleton ${skeletonTitle.y}, loaded ${loadedTitle.y}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonTitle.height - loadedTitle.height), `title height: skeleton ${skeletonTitle.height}, loaded ${loadedTitle.height}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonLine.y - loadedLine.y), `first line top: skeleton ${skeletonLine.y}, loaded ${loadedLine.y}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonLine.x - loadedLine.x), `first line left: skeleton ${skeletonLine.x}, loaded ${loadedLine.x}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonLine.width - loadedLine.width), `first line width: skeleton ${skeletonLine.width}, loaded ${loadedLine.width}`).toBeLessThanOrEqual(1);
    expect(Math.abs(skeletonLine.height - loadedLineHeight), `line box: skeleton ${skeletonLine.height}, prose ${loadedLineHeight}`).toBeLessThanOrEqual(1);
  });
});

test.describe('inside the workspace frame, 320x900 light', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  // The frame's own review measured the bar overflowing at 320 with the
  // lock-lost and save notices inside it. They stand in the pane, above
  // the editor; the bar holds the drawer toggle, the last crumb and this
  // screen's two actions, and nothing scrolls sideways.
  test('the bar holds with the lock-lost notice in the pane, above the editor, and nothing scrolls sideways', async ({ page }) => {
    test.setTimeout(90000);
    await signIn(page);
    await useTheme(page, 'light');
    await page.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          markdown: 'A page whose lock is about to be lost.\n',
          title: 'Heartbeat Test',
          workspaceId: seed.workspaceId,
          contentHash: 'hash-1',
          lock: { holderUserId: 'me', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
        }),
      }),
    );
    // The first heartbeat answers "lost". It is sent one interval after
    // the editor opens — the session response that acquired the lock is
    // the first beat (`useLockHeartbeat`), so the clock is advanced past
    // that interval rather than waiting 20 s of wall time for it.
    await page.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'lost' }) }),
    );
    await page.clock.install();

    await page.goto(`/pages/${PAGE_ID}/edit`);
    const editor = page.getByTestId('editor-surface');
    await expect(editor).toContainText('about to be lost', { timeout: 30000 });
    await page.clock.fastForward(DEFAULT_HEARTBEAT_INTERVAL_MS);

    const notice = page.getByRole('main').getByRole('alert').filter({ hasText: /lock lost/i });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Reload' })).toBeVisible();
    const noticeBox = (await notice.boundingBox())!;
    const editorBox = (await editor.boundingBox())!;
    expect(noticeBox.y + noticeBox.height, 'the notice stands above the editor').toBeLessThanOrEqual(editorBox.y);
    await expect(page.locator('#content-bar')).not.toContainText(/lock lost/i);

    const bar = page.locator('#content-bar');
    await expect(bar.getByRole('button', { name: /^Save/ })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Read page' })).toBeVisible();
    // The one crumb shown at this width is whole, not "Edit…".
    const crumb = page.getByRole('navigation', { name: 'Where you are' }).getByRole('listitem').last();
    await expect(crumb).toHaveText('Editing');
    const clipped = await crumb.evaluate((el) => Array.from(el.querySelectorAll('*')).some((node) => node.scrollWidth > node.clientWidth + 1));
    expect(clipped, 'the Editing crumb is not truncated').toBe(false);
    const barOverflow = await bar.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(barOverflow.scrollWidth, `bar scrollWidth ${barOverflow.scrollWidth} vs clientWidth ${barOverflow.clientWidth}`).toBeLessThanOrEqual(
      barOverflow.clientWidth,
    );
    const box = await overflow(page);
    await expectNoHorizontalOverflow(page, 'editor 320');
    expect(box.scrollHeight).toBe(box.innerHeight);

    await shot3(page, '320-light');
    await shotShell(page, 'edit-320-light');
  });

  // The drawer's toolbar row fills its width too, and neither control
  // drops below 32px or clips (docs/UI-CHECKLIST.md §5, §6). A real
  // session: the toolbar renders only over a tree the caller can read.
  test('the drawer\'s toolbar row fills its width: New… grows, Rename… keeps its width, both 32px', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'light');

    await page.goto(`/pages/${editorFixtures.editablePageId}/edit`);
    await expect(page.getByTestId('editor-surface')).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });

    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByTestId('tree-create-open')).toBeVisible({ timeout: 30000 });
    const createBox = (await drawer.getByTestId('tree-create-open').boundingBox())!;
    const renameBox = (await drawer.getByTestId('tree-rename-open').boundingBox())!;
    const rowBox = (await drawer.getByTestId('tree-create-open').locator('..').boundingBox())!;
    expect(createBox.width, 'New… grows past its natural width').toBeGreaterThan(renameBox.width);
    expect(Math.abs(renameBox.x + renameBox.width - (rowBox.x + rowBox.width)), 'Rename… ends at the row\'s edge').toBeLessThanOrEqual(1);
    expect(Math.round(createBox.height)).toBe(32);
    expect(Math.round(renameBox.height)).toBe(32);
    await expectNoHorizontalOverflow(page, 'drawer 320');
    await shotShell(page, 'sidebar-320-light');
  });
});

/**
 * The confirm dialog, at the sizes and themes the review asks for. The
 * behaviour is held above at 1280 light; these hold that it renders
 * whole — no sideways scroll at 320 — and shoot it.
 */
for (const { theme, width } of [
  { theme: 'dark', width: 1280 },
  { theme: 'light', width: 320 },
] as const) {
  test.describe(`the confirm dialog at ${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('renders the leave question whole, with cancel and confirm reachable', async ({ page }) => {
      test.setTimeout(90000);
      await signInAs(page, editorFixtures.writerSessionToken);
      await useTheme(page, theme);

      await page.goto(`/pages/${editorFixtures.editablePageId}/edit`);
      const editor = page.getByTestId('editor-surface');
      await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Not saved yet.');
      await expect(page.locator('#content-bar').getByRole('button', { name: /^Save/ })).not.toHaveAttribute('aria-disabled');

      await page.locator('#content-bar').getByRole('link', { name: 'Read page' }).click();
      const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Leave' })).toBeVisible();
      const dialogBox = (await dialog.boundingBox())!;
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width, 'the dialog fits the viewport').toBeLessThanOrEqual(width);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
      await shotShell(page, `edit-confirm-${width}-${theme}`);

      await dialog.getByRole('button', { name: 'Keep editing' }).click();
      await expect(dialog).toBeHidden();
      await expect(editor).toContainText('Not saved yet.');
    });
  });
}

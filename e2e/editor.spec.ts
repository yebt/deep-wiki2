import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '../apps/web/app/composables/useLockHeartbeat';
import { API_URL } from './ports';
import { expectNoHorizontalOverflow } from './overflow';
import { pageEditUrl, pageUrl } from '../apps/web/app/utils/routes';

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
/** The mocked-route tests below never seed a real workspace — any well-formed slug works, since these screens read the page by id from the mocked API, not the slug from a real backend. */
const WORKSPACE_SLUG = 'e2e-editor-mock';

interface SeedFixtures {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
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

/**
 * Puts the caret after the last character of the document's last block
 * and returns once ProseMirror has read it. `editor.click()` + `End` +
 * a key is what these tests did, and it is a race: Chrome delivers
 * `selectionchange` at the next rendering opportunity, so ProseMirror
 * learns where the click put the caret one frame later — and a key sent
 * inside that frame is handled at the caret ProseMirror still holds, the
 * start of the document on a fresh mount. Measured 2026-09-16: `Enter`
 * split the paragraph at its START in 15 of 20 unthrottled runs —
 * `"SecondStart."` in the h2, a table above `Before the table.` and a
 * "not canonical" refusal on Save — and a page-side event log showed no
 * `selectionchange` at all between `mouseup` and `keydown Enter` in every
 * run that split there. Six-times CPU throttling, which stretches the
 * frame past Playwright's next key, made it 0 of 20. No hand is that
 * fast; the harness is (docs/TODO.md Findings, 2026-09-16).
 *
 * So: click just inside the block's right edge, which is where `End` was
 * taking the caret, and wait for the surface's `data-transactions` — the
 * count the view reports after every transaction, the pointer's
 * selection-only one included — to move past what it was before the
 * click. That is ProseMirror saying it has the caret; a timeout would be
 * a guess about the frame.
 */
async function caretToEnd(editor: Locator): Promise<void> {
  const before = (await editor.getAttribute('data-transactions')) ?? '0';
  const last = editor.locator(':scope > *').last();
  const box = await last.boundingBox();
  if (!box) throw new Error('caretToEnd: the editor has no block to click');
  await last.click({ position: { x: Math.max(1, box.width - 2), y: box.height / 2 } });
  await expect(editor, 'ProseMirror has read the caret the click placed').not.toHaveAttribute('data-transactions', before);
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

  await page.goto(pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId));
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });

  await caretToEnd(editor);
  await page.keyboard.type(' Edited for real, through the real backend.');

  // The buffer reports 300ms after the last keystroke; Save enabling is
  // the screen's word that it has (docs/TODO.md Findings, 2026-09-16: a
  // click inside that window once saved the pre-edit document).
  const save = page.getByRole('button', { name: /Save/ });
  await expect(save).not.toHaveAttribute('aria-disabled');
  await save.click();
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

  await page.goto(pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId));
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
  // The writer can read one page — this one — so its own row is the tree
  // row to click: from `/edit` it opens the page for reading, a route
  // change the guard sees like any other.
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  const otherRow = sidebar.getByRole('treeitem', { name: new RegExp(editorFixtures.editablePageTitle) });
  await expect(otherRow).toBeVisible({ timeout: 30000 });

  await caretToEnd(editor);
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
  await expect(page).toHaveURL(new RegExp(`${pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId)}$`));
  await expect(editor).toContainText('Not saved yet.');

  await otherRow.getByText(editorFixtures.editablePageTitle).click();
  await expect(dialog).toBeVisible();
  await shotShell(page, 'edit-confirm-1280-light');
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId)}$`));
  await expect(editor).toContainText('Not saved yet.');
  // Focus came back to the control that asked (§5).
  await expect(otherRow).toBeFocused();

  await otherRow.getByText(editorFixtures.editablePageTitle).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(new RegExp(`${pageUrl(seed.workspaceSlug, editorFixtures.editablePageId)}$`), { timeout: 30000 });
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
        workspace: { id: 'ws-e2e', slug: WORKSPACE_SLUG },
        lock: { holderUserId: 'me', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
      }),
    }),
  );
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );

  await page.goto(pageEditUrl(WORKSPACE_SLUG, PAGE_ID));

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
  await caretToEnd(editor);
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

  await page.goto(pageEditUrl(WORKSPACE_SLUG, PAGE_ID));

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
        workspace: { id: 'ws-e2e', slug: WORKSPACE_SLUG },
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

  await page.goto(pageEditUrl(WORKSPACE_SLUG, PAGE_ID));
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(editor).toContainText('Not canonical', { timeout: 30000 });
  await caretToEnd(editor);
  await page.keyboard.type(' edited');

  await expect(page.getByRole('button', { name: /Save/ })).not.toHaveAttribute('aria-disabled');
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
        workspace: { id: 'ws-e2e', slug: WORKSPACE_SLUG },
        lock: { holderUserId: 'me', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
      }),
    }),
  );
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );

  await page.goto(pageEditUrl(WORKSPACE_SLUG, PAGE_ID));
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toContainText('Start.', { timeout: 30000 });
  await caretToEnd(editor);
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
        workspace: { id: 'ws-e2e', slug: WORKSPACE_SLUG },
        lock: { holderUserId: 'me', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
      }),
    }),
  );
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );
  await page.goto(pageEditUrl(WORKSPACE_SLUG, PAGE_ID));
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

  await caretToEnd(editor);
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

/* ─── The block UI against the real backend ─────────────────────────────
 * The selection toolbar, the block handle and its tunes, and the `/`
 * commands the editor package added on 2026-09-16 (docs/TODO.md Findings,
 * "the `/mount` API"). Every test here drives a real edit session and a
 * real Save, then reads the row back through a fresh edit-session
 * request — the same holder, so the lock is simply renewed — because the
 * claim under test is what the markdown *bytes* become, which a mocked
 * PUT cannot answer. Each test mints its own writer and page
 * (`e2e/editor-fixtures.bun.ts`) and writes the document it needs
 * through the API first, so the tests share nothing and run in any order.
 */
const UI_SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

/** The review material for this batch: `fb-editor-ui-<screen>-<size>-<theme>.png`. */
async function shotUi(page: Page, name: string): Promise<void> {
  if (!UI_SHOTS) return;
  await page.screenshot({ path: `${UI_SHOTS}/fb-editor-ui-${name}.png`, fullPage: false });
}

interface BlockPage {
  readonly pageId: string;
  readonly title: string;
}

/** A fresh writer and page holding exactly `markdown`, signed in on `page`. */
async function seedBlockPage(page: Page, markdown: string): Promise<BlockPage> {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  const minted: EditorFixtures = JSON.parse(output.trim().split('\n').pop()!);
  await signInAs(page, minted.writerSessionToken);
  const session = await page.request.get(`${apiOrigin()}/pages/${minted.editablePageId}/edit-session`);
  expect(session.ok()).toBe(true);
  const { contentHash } = (await session.json()) as { contentHash: string };
  const saved = await page.request.put(`${apiOrigin()}/pages/${minted.editablePageId}`, { data: { markdown, expectedContentHash: contentHash } });
  expect(saved.ok()).toBe(true);
  return { pageId: minted.editablePageId, title: minted.editablePageTitle };
}

/** What the row holds now, as the editor would open it. */
async function savedMarkdown(page: Page, pageId: string): Promise<string> {
  const session = await page.request.get(`${apiOrigin()}/pages/${pageId}/edit-session`);
  expect(session.ok()).toBe(true);
  return ((await session.json()) as { markdown: string }).markdown;
}

async function openBlockPage(page: Page, block: BlockPage, firstWords: string): Promise<ReturnType<Page['getByTestId']>> {
  await page.goto(pageEditUrl(seed.workspaceSlug, block.pageId));
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toContainText(firstWords, { timeout: 30000 });
  return editor;
}

/** Selects `word` inside the editor's `nth` paragraph through the DOM selection, which ProseMirror reads back into its state. */
async function selectWord(editor: ReturnType<Page['getByTestId']>, nth: number, word: string): Promise<void> {
  await editor.locator(':scope > p').nth(nth).evaluate((paragraph, needle) => {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${needle}" not found`);
  }, word);
}

/** Save, and wait for the screen's own word that the row holds it — never inside the 300ms window the buffer reports in. */
async function saveAndConfirm(page: Page): Promise<void> {
  const save = page.locator('#content-bar').getByRole('button', { name: /^Save/ });
  await expect(save).not.toHaveAttribute('aria-disabled');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 30000 });
}

test.describe('the block UI against the real backend, 1280x900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('selecting a word shows the toolbar above it; Bold marks it and saves as __word__; Bold again restores the original bytes', async ({ page }) => {
    test.setTimeout(120000);
    const original = 'A paragraph with one word to embolden.\n';
    const block = await seedBlockPage(page, original);
    const editor = await openBlockPage(page, block, 'A paragraph with one word');
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
    await expect(toolbar).toHaveCount(0);

    await editor.click();
    await selectWord(editor, 0, 'word');
    await expect(toolbar).toBeVisible();
    // Above the line it formats, whole, inside the viewport.
    const lineBox = (await editor.locator(':scope > p').first().boundingBox())!;
    const toolbarBox = (await toolbar.boundingBox())!;
    expect(toolbarBox.y + toolbarBox.height, 'stands above the selected line').toBeLessThanOrEqual(lineBox.y);
    expect(toolbarBox.x).toBeGreaterThanOrEqual(0);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(1280);
    const bold = toolbar.getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await shotUi(page, 'toolbar-1280-light');

    await bold.click();
    await expect(editor.locator('strong')).toHaveText('word');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await expect(editor, 'the click left focus in the editor').toBeFocused();
    await saveAndConfirm(page);
    // `__` is the pinned strong spelling (`packages/markdown/src/pipeline.ts`).
    expect(await savedMarkdown(page, block.pageId)).toBe('A paragraph with one __word__ to embolden.\n');

    // Save took focus, so the toolbar went with it (it is up only while
    // the editor or the toolbar has focus). Back in the range it reads as
    // pressed, and the same button now unbolds: the round trip is
    // byte-identical to what the page held before.
    await expect(toolbar).toHaveCount(0);
    await editor.click();
    await selectWord(editor, 0, 'word');
    await expect(toolbar).toBeVisible();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await bold.click();
    await expect(editor.locator('strong')).toHaveCount(0);
    await saveAndConfirm(page);
    expect(await savedMarkdown(page, block.pageId)).toBe(original);
  });

  test('the toolbar is keyboard-reachable: Ctrl+Shift+. focuses it, arrows move along it, Enter toggles, Escape returns to the editor', async ({ page }) => {
    test.setTimeout(120000);
    const block = await seedBlockPage(page, 'Keyboard reaches the toolbar too.\n');
    const editor = await openBlockPage(page, block, 'Keyboard reaches');
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });

    await editor.click();
    await selectWord(editor, 0, 'reaches');
    await expect(toolbar).toBeVisible();

    await page.keyboard.press('Control+Shift+Period');
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button', { name: 'Italic' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(editor.locator('em')).toHaveText('reaches');
    await expect(toolbar.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(editor).toBeFocused();
    // Typing replaces the selection, and the toolbar goes with it.
    await page.keyboard.type('finds');
    await expect(editor).toContainText('Keyboard finds the toolbar too.');
    await expect(toolbar).toHaveCount(0);
  });

  test('the link control: a URL applied from the popover saves as [text](url), and Remove link takes it off again', async ({ page }) => {
    test.setTimeout(120000);
    const block = await seedBlockPage(page, 'Read the spec before deciding.\n');
    const editor = await openBlockPage(page, block, 'Read the spec');
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });

    await editor.click();
    await selectWord(editor, 0, 'spec');
    await toolbar.getByRole('button', { name: 'Link' }).click();
    const dialog = page.getByRole('dialog');
    const field = dialog.getByLabel('Link URL');
    await expect(field).toBeFocused();
    await field.fill('https://example.com/spec');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/spec');
    await expect(editor).toBeFocused();
    await saveAndConfirm(page);
    expect(await savedMarkdown(page, block.pageId)).toBe('Read the [spec](https://example.com/spec) before deciding.\n');

    await selectWord(editor, 0, 'spec');
    await expect(toolbar.getByRole('button', { name: 'Link' })).toHaveAttribute('aria-pressed', 'true');
    await toolbar.getByRole('button', { name: 'Link' }).click();
    await expect(dialog.getByLabel('Link URL')).toHaveValue('https://example.com/spec');
    await dialog.getByRole('button', { name: 'Remove link' }).click();
    await expect(editor.locator('a')).toHaveCount(0);
    await saveAndConfirm(page);
    expect(await savedMarkdown(page, block.pageId)).toBe('Read the spec before deciding.\n');
  });
});

/** Hovers the editor's `nth` top-level block and returns the one block handle once it stands beside it. */
async function hoverBlock(page: Page, editor: ReturnType<Page['getByTestId']>, nth: number) {
  const block = editor.locator(':scope > *').nth(nth);
  await block.hover({ position: { x: 20, y: 8 } });
  const handle = page.getByRole('button', { name: 'Block options' });
  await expect(handle).toBeVisible();
  return handle;
}

test.describe('the block handle against the real backend, 1280x900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('one handle follows the hovered block in the left margin; dragging it below the last block moves the block, anchor and all, in the saved markdown', async ({ page }) => {
    test.setTimeout(120000);
    const block = await seedBlockPage(page, 'First paragraph. ^blk0001\n\nSecond paragraph. ^blk0002\n\nThird paragraph. ^blk0003\n');
    const editor = await openBlockPage(page, block, 'First paragraph.');
    await expect(page.getByRole('button', { name: 'Block options' })).toHaveCount(0);

    const first = editor.locator(':scope > p').nth(0);
    const third = editor.locator(':scope > p').nth(2);
    const handle = await hoverBlock(page, editor, 0);
    const handleBox = (await handle.boundingBox())!;
    const firstBox = (await first.boundingBox())!;
    expect(handleBox.width, '24px target (§5)').toBeGreaterThanOrEqual(24);
    expect(handleBox.height).toBeGreaterThanOrEqual(24);
    expect(handleBox.x + handleBox.width, 'in the margin, left of the text').toBeLessThanOrEqual(firstBox.x);
    expect(Math.abs(handleBox.y + handleBox.height / 2 - (firstBox.y + 13)), 'centred on the first line').toBeLessThanOrEqual(2);
    // The same handle, moved: hovering the third block puts it there.
    await hoverBlock(page, editor, 2);
    const thirdBox = (await third.boundingBox())!;
    const movedBox = (await handle.boundingBox())!;
    expect(Math.abs(movedBox.y - thirdBox.y)).toBeLessThanOrEqual(4);
    await expect(page.getByRole('button', { name: 'Block options' })).toHaveCount(1);

    // Drag the first block to below the third.
    await hoverBlock(page, editor, 0);
    await handle.dragTo(third, { targetPosition: { x: (await third.boundingBox())!.width - 4, y: 12 } });
    await expect(editor.locator(':scope > p').nth(0)).toHaveText('Second paragraph.');
    await expect(editor.locator(':scope > p').nth(2)).toHaveText('First paragraph.');
    await saveAndConfirm(page);
    expect(await savedMarkdown(page, block.pageId)).toBe('Second paragraph. ^blk0002\n\nThird paragraph. ^blk0003\n\nFirst paragraph. ^blk0001\n');
  });

  test('the tunes menu: Duplicate inserts a copy without the anchor, so the saved markdown carries one ^id; Move up and the keys move it back', async ({ page }) => {
    test.setTimeout(120000);
    const block = await seedBlockPage(page, 'Only paragraph. ^dupl0001\n\nA second one.\n');
    const editor = await openBlockPage(page, block, 'Only paragraph.');

    const handle = await hoverBlock(page, editor, 0);
    await handle.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitem');
    await expect(items.filter({ hasText: 'Turn into' })).toBeVisible();
    // The first block: Move up stays in the menu, disabled, with its reason on show (§3, §5).
    const moveUp = items.filter({ hasText: 'Move up' });
    await expect(moveUp).toHaveAttribute('aria-disabled', 'true');
    await expect(moveUp).toContainText('Already the first block.');
    await shotUi(page, 'tunes-1280-light');

    await items.filter({ hasText: 'Duplicate' }).click();
    await expect(menu).toBeHidden();
    await expect(editor.locator(':scope > p')).toHaveCount(3);
    await expect(editor).toBeFocused();
    await saveAndConfirm(page);
    const afterDuplicate = await savedMarkdown(page, block.pageId);
    expect(afterDuplicate).toBe('Only paragraph. ^dupl0001\n\nOnly paragraph.\n\nA second one.\n');
    expect(afterDuplicate.match(/\^/g)).toHaveLength(1);

    // Move the last block up through the menu, then back down with the keys the menu names.
    await hoverBlock(page, editor, 2);
    await handle.click();
    await menu.getByRole('menuitem').filter({ hasText: 'Move up' }).click();
    await expect(editor.locator(':scope > p').nth(1)).toHaveText('A second one.');
    await editor.locator(':scope > p').nth(1).click();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(editor.locator(':scope > p').nth(2)).toHaveText('A second one.');
  });

  test('Ctrl+/ opens the tunes for the caret\'s block; Turn into on a list item lifts it to text first, so the heading is not nested in the item', async ({ page }) => {
    test.setTimeout(120000);
    const block = await seedBlockPage(page, '- item one\n- item two\n');
    const editor = await openBlockPage(page, block, 'item one');

    await editor.locator('li').first().click();
    await page.keyboard.press('Control+Slash');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const turnInto = menu.getByRole('menuitem').filter({ hasText: 'Turn into' });
    await turnInto.hover();
    const submenu = page.getByRole('menu').last();
    await expect(submenu.getByRole('menuitem').first()).toHaveText(/^Text/);
    await expect(submenu.getByRole('menuitem').filter({ hasText: 'Bulleted list' })).toHaveAttribute('aria-disabled', 'true');
    await submenu.getByRole('menuitem').filter({ hasText: 'Heading 1' }).click();

    await expect(editor.locator('h1')).toHaveText('item one');
    await expect(editor.locator('li')).toHaveCount(1);
    await saveAndConfirm(page);
    expect(await savedMarkdown(page, block.pageId)).toBe('# item one\n\n- item two\n');
  });
});

/**
 * The `/` menu's newest commands, landed where the editor package says
 * they land (docs/TODO.md Findings 2026-09-16): `/table` puts the caret
 * in the first cell of an empty 2x2 table, `/footnote` puts `[^n]` at the
 * caret and the caret in the empty definition at the end. Proved by what
 * typing next does, and by the saved bytes.
 */
test.describe('the / menu against the real backend', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('/table inserts an empty 2x2 table with the caret in its first cell, and the saved markdown spells it canonically', async ({ page }) => {
    test.setTimeout(120000);
    const block = await seedBlockPage(page, 'Before the table.\n');
    const editor = await openBlockPage(page, block, 'Before the table.');

    await caretToEnd(editor);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/tab');
    const menu = page.getByRole('listbox', { name: 'Block commands' });
    const table = menu.getByRole('option', { name: /Table/ });
    await expect(table).toBeVisible();
    // The icon is beside the label, never instead of it (§4.3).
    await expect(table).toContainText('Table');
    await expect(table.locator('svg, [class*="i-lucide"]').first()).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Enter');
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('td, th')).toHaveCount(4);
    await page.keyboard.type('cell');
    await expect(editor.locator('td, th').first()).toHaveText('cell');

    await saveAndConfirm(page);
    expect(await savedMarkdown(page, block.pageId)).toBe('Before the table.\n\n| cell |   |\n| ---- | - |\n|      |   |\n');
  });

  test('/footnote puts the reference at the caret and the caret in the note at the end; the note typed next saves with it', async ({ page }) => {
    test.setTimeout(120000);
    const block = await seedBlockPage(page, 'A claim worth a note.\n');
    const editor = await openBlockPage(page, block, 'A claim worth a note.');

    await caretToEnd(editor);
    // The trigger fires after whitespace or at a line's start, never mid-word.
    await page.keyboard.type(' /foot');
    const menu = page.getByRole('listbox', { name: 'Block commands' });
    await expect(menu.getByRole('option', { name: /Footnote/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await page.keyboard.type('The note itself.');
    await expect(editor).toContainText('The note itself.');
    await expect(editor.locator(':scope > p').first()).not.toContainText('The note itself.');

    await saveAndConfirm(page);
    expect(await savedMarkdown(page, block.pageId)).toBe('A claim worth a note. [^1]\n\n[^1]: The note itself.\n');
  });
});

/**
 * The block UI at the sizes and themes the review asks for, measured
 * where a screenshot cannot see: nothing scrolls sideways at 320 with
 * the toolbar, the menu or a drag up; every floating surface stays inside
 * the viewport. The screenshots are the review material
 * (`fb-editor-ui-*.png`).
 */
for (const { theme, width } of [
  { theme: 'light', width: 1280 },
  { theme: 'dark', width: 1280 },
  { theme: 'light', width: 320 },
] as const) {
  test.describe(`the block UI at ${width} ${theme}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('idle surface, selection toolbar, tunes menu and a drag in progress all stay inside the viewport', async ({ page }) => {
      test.setTimeout(120000);
      await useTheme(page, theme);
      const block = await seedBlockPage(page, 'First paragraph of the page. ^shot0001\n\nSecond paragraph, a little longer than the first. ^shot0002\n\nThird and last. ^shot0003\n');
      const editor = await openBlockPage(page, block, 'First paragraph');
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
      const label = `block ui ${width} ${theme}`;
      // Idle: no chrome inside the column at all.
      await expect(page.getByRole('button', { name: 'Block options' })).toHaveCount(0);
      await expect(page.getByRole('toolbar')).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `${label} idle`);
      await shotUi(page, `surface-${width}-${theme}`);

      await editor.click();
      await selectWord(editor, 1, 'longer');
      const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
      await expect(toolbar).toBeVisible();
      const toolbarBox = (await toolbar.boundingBox())!;
      expect(toolbarBox.x).toBeGreaterThanOrEqual(0);
      expect(toolbarBox.x + toolbarBox.width, 'the toolbar fits the viewport').toBeLessThanOrEqual(width);
      await expectNoHorizontalOverflow(page, `${label} toolbar`);
      await shotUi(page, `toolbar-${width}-${theme}`);

      const handle = await hoverBlock(page, editor, 1);
      await handle.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width, 'the menu fits the viewport').toBeLessThanOrEqual(width);
      await expectNoHorizontalOverflow(page, `${label} tunes`);
      await shotUi(page, `tunes-${width}-${theme}`);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(editor).toBeFocused();

      // A drag in progress: pressed on the handle, moved over the third
      // block, not yet released — the drop cursor is up.
      await hoverBlock(page, editor, 0);
      const handleBox = (await handle.boundingBox())!;
      const third = (await editor.locator(':scope > p').nth(2).boundingBox())!;
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(third.x + third.width - 8, third.y + third.height - 4, { steps: 12 });
      await expect(page.locator('.editor-drop-cursor')).toBeVisible();
      await expectNoHorizontalOverflow(page, `${label} drag`);
      await shotUi(page, `drag-${width}-${theme}`);
      await page.mouse.up();
      await expect(editor.locator(':scope > p').nth(2)).toHaveText('First paragraph of the page.');
    });
  });
}

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

/** The 2026-09-17 batch's review material: the confirm dialog above the drawer. */
async function shotRoutes(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-routes-${name}.png`, fullPage: false });
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
      await page.goto(pageUrl(seed.workspaceSlug, editorFixtures.editablePageId));
      const readTitle = page.getByRole('heading', { level: 1, name: editorFixtures.editablePageTitle });
      await expect(readTitle).toBeVisible({ timeout: 30000 });
      const readTitleBox = (await readTitle.boundingBox())!;
      const readParagraph = (await page.locator('article > p').first().boundingBox())!;

      // Edit mode, by the control read mode offers — the transition a
      // person actually makes (docs/UI-CHECKLIST.md §4.5).
      await page.getByRole('link', { name: 'Edit', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId)}$`));
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

      // The sidebar's toolbar row fills the pane: New… grows, the other two
      // keep their natural widths, and nothing is left empty to the right.
      // The row's last control has been the icon-only Delete since
      // 2026-09-18; this assertion still named Rename… and had been failing
      // by exactly Delete's 36px ever since (docs/TODO.md Findings,
      // 2026-09-23). It asks for the row's *last* control now, so a fourth
      // one cannot silently walk past the edge either.
      const createBox = (await sidebar.getByTestId('tree-create-open').boundingBox())!;
      const renameBox = (await sidebar.getByTestId('tree-rename-open').boundingBox())!;
      const deleteBox = (await sidebar.getByTestId('tree-delete-open').boundingBox())!;
      const rowBox = (await sidebar.getByTestId('tree-create-open').locator('..').boundingBox())!;
      expect(createBox.width, 'New… grows past its natural width').toBeGreaterThan(renameBox.width);
      expect(Math.abs(deleteBox.x + deleteBox.width - (rowBox.x + rowBox.width)), 'the last control ends at the row\'s edge').toBeLessThanOrEqual(1);
      expect(Math.round(createBox.height)).toBe(32);
      expect(Math.round(renameBox.height)).toBe(32);
      expect(Math.round(deleteBox.height)).toBe(32);

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

    await page.goto(pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId));
    const editor = page.getByTestId('editor-surface');
    await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
    const sidebar = page.getByRole('navigation', { name: 'Workspace' });
    await expect(sidebar).toBeVisible();
    const before = (await editor.boundingBox())!;
    const save = page.getByRole('button', { name: /^Save/ });
    await expect(save).toHaveAttribute('aria-disabled', 'true');

    await caretToEnd(editor);
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

    await page.goto(pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId));
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

    await page.goto(pageEditUrl(WORKSPACE_SLUG, PAGE_ID));
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

    await page.goto(pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId));
    await expect(page.getByTestId('editor-surface')).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });

    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByTestId('tree-create-open')).toBeVisible({ timeout: 30000 });
    // The drawer slides in; measured mid-animation the row is still
    // narrower than it will be (21.9px short under load, 2026-09-16), so
    // the geometry is polled until the row has settled at its width.
    await expect
      .poll(async () => {
        const last = (await drawer.getByTestId('tree-delete-open').boundingBox())!;
        const row = (await drawer.getByTestId('tree-create-open').locator('..').boundingBox())!;
        return Math.abs(last.x + last.width - (row.x + row.width));
      })
      .toBeLessThanOrEqual(1);
    const createBox = (await drawer.getByTestId('tree-create-open').boundingBox())!;
    const renameBox = (await drawer.getByTestId('tree-rename-open').boundingBox())!;
    const deleteBox = (await drawer.getByTestId('tree-delete-open').boundingBox())!;
    const rowBox = (await drawer.getByTestId('tree-create-open').locator('..').boundingBox())!;
    expect(createBox.width, 'New… grows past its natural width').toBeGreaterThan(renameBox.width);
    expect(Math.abs(deleteBox.x + deleteBox.width - (rowBox.x + rowBox.width)), 'the last control ends at the row\'s edge').toBeLessThanOrEqual(1);
    expect(Math.round(createBox.height)).toBe(32);
    expect(Math.round(renameBox.height)).toBe(32);
    expect(Math.round(deleteBox.height)).toBe(32);
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

      await page.goto(pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId));
      const editor = page.getByTestId('editor-surface');
      await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
      await caretToEnd(editor);
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

    /**
     * The question outranks the drawer it was asked from (owner decision,
     * 2026-09-17; docs/DESIGN-SYSTEM.md §4.5). Recorded on 2026-09-16 as
     * known-and-not-fixed: at 320 the drawer — a Reka dialog portalled into
     * the body when opened — stood *above* "Leave without saving?", both
     * at `z-index: auto`, so Escape could answer it and a pointer could
     * not. What this measures is the pointer's view: the element at the
     * centre of Cancel is Cancel, the scrim covers the drawer's row, and —
     * focus being Reka's own stack, untouched by the rung — focus is in
     * the dialog while the drawer waits behind it, and back on the row
     * that asked once it closes.
     */
    if (width === 320) {
      test('asked from a row in the open drawer, the dialog stands above the drawer: the pointer reaches Cancel, focus is inside, and returns to the row', async ({ page }) => {
        test.setTimeout(90000);
        await signInAs(page, editorFixtures.writerSessionToken);
        await useTheme(page, theme);

        await page.goto(pageEditUrl(seed.workspaceSlug, editorFixtures.editablePageId));
        const editor = page.getByTestId('editor-surface');
        await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
        await caretToEnd(editor);
        await page.keyboard.type(' Not saved yet.');
        await expect(page.locator('#content-bar').getByRole('button', { name: /^Save/ })).not.toHaveAttribute('aria-disabled');

        await page.getByRole('button', { name: 'Open sidebar' }).click();
        // The drawer is the dialog that slides in from a side. By CSS rather
        // than by role: once the question opens, Reka hides everything else
        // from assistive technology, and a role query would find nothing —
        // which is the point of the measurement, not an obstacle to it.
        const drawer = page.locator('[role="dialog"][data-side]');
        const row = drawer.locator('[role="treeitem"]', { hasText: editorFixtures.editablePageTitle }).first();
        await expect(row).toBeVisible({ timeout: 30000 });
        await row.getByText(editorFixtures.editablePageTitle).click();

        const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
        await expect(dialog).toBeVisible();
        await expect(drawer).toBeVisible();
        const cancel = dialog.getByRole('button', { name: 'Keep editing' });
        await expect(cancel).toBeFocused();

        // The dialog is on the rung above the drawer, scrim and content.
        const stacking = await page.evaluate(() => {
          const question = document.querySelector<HTMLElement>('[role="dialog"]:not([data-side])')!;
          const overlay = document.querySelector<HTMLElement>('[data-slot="overlay"].z-70')!;
          const drawerPane = document.querySelector<HTMLElement>('[role="dialog"][data-side]')!;
          return { content: getComputedStyle(question).zIndex, overlay: getComputedStyle(overlay).zIndex, drawer: getComputedStyle(drawerPane).zIndex };
        });
        expect(stacking).toEqual({ content: '70', overlay: '70', drawer: 'auto' });

        // What the pointer would hit: Cancel, at its own centre, and the
        // scrim — never the drawer's row — at the row's centre.
        const cancelBox = (await cancel.boundingBox())!;
        const rowBox = (await row.boundingBox())!;
        const hit = await page.evaluate(
          ({ cancelAt, rowAt }) => {
            const describe = (element: Element | null) => {
              if (!element) return null;
              const dialog = element.closest('[role="dialog"]');
              return { text: element.textContent?.trim() ?? '', inDialog: dialog !== null && !dialog.hasAttribute('data-side'), inDrawer: dialog !== null && dialog.hasAttribute('data-side') };
            };
            return {
              cancel: describe(document.elementFromPoint(cancelAt.x, cancelAt.y)?.closest('button') ?? document.elementFromPoint(cancelAt.x, cancelAt.y)),
              row: describe(document.elementFromPoint(rowAt.x, rowAt.y)),
            };
          },
          { cancelAt: { x: cancelBox.x + cancelBox.width / 2, y: cancelBox.y + cancelBox.height / 2 }, rowAt: { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height / 2 } },
        );
        expect(hit.cancel).toEqual({ text: 'Keep editing', inDialog: true, inDrawer: false });
        expect(hit.row?.inDrawer, 'the scrim covers the drawer').toBe(false);
        await shotRoutes(page, `edit-confirm-drawer-${width}-${theme}`);

        // Focus is trapped in the dialog while the drawer waits behind it.
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: 'Leave' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(cancel).toBeFocused();

        await cancel.click();
        await expect(dialog).toBeHidden();
        await expect(row).toBeFocused();
        await expect(editor).toContainText('Not saved yet.');
      });
    }
  });
}

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';
import { expectNoHorizontalOverflow } from './overflow';
import { pageEditUrl, pageUrl } from '../apps/web/app/utils/routes';

/**
 * The comment gutter and thread panel on the read screen (comment-overlay
 * and comment-threads specs; docs/UI-CHECKLIST.md §4.7; tasks.md 10.7 and
 * 10.9), against a real backend: the pages, threads, commenter and editor
 * are minted into the seeded database by `e2e/comments-fixtures.bun.ts`
 * (see its own note on why the seed itself mints no one who may comment).
 *
 * Every assertion is on what a user sees and does: a mark beside the text,
 * a click on it, a reply typed and posted, a thread resolved, and — the
 * orphan case — a paragraph deleted by another user's real save, so that
 * save-time reconciliation, not a mock, is what orphans the thread.
 */

interface SeedFixtures {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly readerSessionToken: string;
}

interface CommentFixtures {
  readonly commenterSessionToken: string;
  readonly editorSessionToken: string;
  readonly commentsPageId: string;
  readonly commentsPageTitle: string;
  readonly commentedQuote: string;
  readonly orphanPageId: string;
  readonly orphanPageTitle: string;
  readonly orphanQuote: string;
  readonly legacyPageId: string;
  readonly legacyPageTitle: string;
  readonly legacyQuote: string;
  readonly freshPageId: string;
  readonly freshPageTitle: string;
  readonly freshFirstParagraph: string;
  readonly freshSecondParagraph: string;
}

const SHOTS = process.env.DEEPWIKI_FB_COMMENTS_SHOTS ?? '';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-comments-${name}.png`, fullPage: false });
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
const REPO_ROOT = join(import.meta.dirname, '..');

let fixtures: CommentFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/comments-fixtures.bun.ts', seed.workspaceId], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CHANGESET_WINDOW_MINUTES: '30' },
  });
  fixtures = JSON.parse(output.trim().split('\n').pop()!);
});

// Serial, like e2e/read.spec.ts: the read route is compiled on first visit
// by the dev server, and the orphan case depends on its own edit having
// landed before the reader looks.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Comments' });
}

test('a commenter opens a thread from the mark beside its block, replies, and resolves it — by clicking', async ({ page, context }) => {
  await signInAs(context, fixtures.commenterSessionToken);

  await page.goto(pageUrl(seed.workspaceSlug, fixtures.commentsPageId));
  await expect(page.getByRole('heading', { level: 1, name: fixtures.commentsPageTitle })).toBeVisible({ timeout: 30000 });

  // One mark, beside the commented block, counting root plus reply, and
  // level with the block it belongs to — outside the reading column, which
  // keeps its measured width (§4.4, §6: 658.9px at x=310.5 at 1280).
  const mark = page.getByRole('button', { name: '2 comments on this block' });
  await expect(mark).toBeVisible({ timeout: 30000 });
  const block = page.locator('[data-block-id="E2ECMTTWO"]');
  await expect(block).toContainText(fixtures.commentedQuote);
  const blockBox = (await block.boundingBox())!;
  const markBox = (await mark.boundingBox())!;
  const articleBox = (await page.locator('article').boundingBox())!;
  expect(markBox.y, `mark top ${markBox.y} within block ${blockBox.y}..${blockBox.y + blockBox.height}`).toBeGreaterThanOrEqual(blockBox.y - 1);
  expect(markBox.y).toBeLessThan(blockBox.y + blockBox.height);
  expect(markBox.x, 'the mark stands outside the column').toBeGreaterThanOrEqual(articleBox.x + articleBox.width);
  expect(Math.round(articleBox.width * 10) / 10, 'the column keeps its measure').toBeCloseTo(658.9, 0);
  // Since 2026-09-15 the column is centred in the content pane beside the
  // sidebar, not in the viewport: its position is the pane's left edge
  // plus half the pane's spare width.
  const sidebarBox = (await page.getByRole('navigation', { name: 'Workspace' }).boundingBox())!;
  const paneLeft = sidebarBox.x + sidebarBox.width;
  const expectedX = paneLeft + (1280 - paneLeft - articleBox.width) / 2;
  expect(Math.round(articleBox.x * 10) / 10, 'the column keeps its position').toBeCloseTo(expectedX, 0);
  expect(markBox.width, 'a 24px target with room to spare').toBeGreaterThanOrEqual(24);
  expect(markBox.height).toBeGreaterThanOrEqual(24);

  // Nothing is highlighted until a thread is opened.
  await expect(page.getByTestId('comment-highlight')).toHaveCount(0);

  await mark.click();

  const panel = dialog(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(fixtures.commentedQuote);
  await expect(panel).toContainText('Is this paragraph still accurate after the migration?');
  await expect(panel).toContainText('I believe so, but the date needs checking.');
  await expect(panel).toContainText('E2E Commenter');
  await expect(page.getByTestId('comment-highlight')).toBeVisible();
  // While the modal panel is open the page behind it is inert to the
  // accessibility tree, so the mark is located by attribute here.
  await expect(page.locator('button[aria-label="2 comments on this block"]')).toHaveAttribute('aria-pressed', 'true');

  // Reply.
  await panel.getByLabel('Reply').fill('Checked: the date is right.');
  await panel.getByRole('button', { name: 'Reply' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Reply posted.' })).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText('Checked: the date is right.');

  // Resolve: the word and an icon, and the control flips to Reopen.
  await panel.getByRole('button', { name: 'Resolve' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Thread resolved.' })).toBeVisible({ timeout: 30000 });
  await expect(panel.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reopen' })).toBeVisible();

  // Escape dismisses the panel, and with it the highlight (§4.7: the
  // highlight is dismissible and does not persist). The mark now counts
  // the reply that was just posted.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('comment-highlight')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '3 comments on this block' })).toBeVisible();
});

test('a reader with read but not comment sees the page and nothing of the overlay — no gutter, no chip, no panel', async ({ page, context }) => {
  await signInAs(context, seed.readerSessionToken);

  await page.goto(pageUrl(seed.workspaceSlug, fixtures.commentsPageId));
  await expect(page.getByRole('heading', { level: 1, name: fixtures.commentsPageTitle })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(fixtures.commentedQuote)).toBeVisible();

  // The block is anchored — the attribute is in the cached HTML for every
  // viewer — and still nothing is drawn beside it.
  await expect(page.locator('[data-block-id="E2ECMTTWO"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /on this block$/ })).toHaveCount(0);
  await expect(page.locator('[data-notice-tier="chip"]')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain('Is this paragraph still accurate');

  // Nor any way to start one: no "+" on hover, no "Comment" on a
  // selection. The API answered `canComment: false`; the client draws no
  // empty affordance.
  await page.getByText(fixtures.commentedQuote).hover();
  await expect(page.getByRole('button', { name: 'Comment on this block' })).toHaveCount(0);
  await page.getByText(fixtures.commentedQuote).selectText();
  await expect(page.getByTestId('comment-selection-action')).toHaveCount(0);
});

/**
 * Starting a thread from read mode (2026-09-16; the gap gate 10.8 found).
 * The fresh page carries no persisted anchor, so the first thread drives
 * the whole mint: the "+" beside a block the render named only by its
 * derived id, the composer, an optimistic mark and thread, the server's
 * anchor written into the Markdown and its re-render — and a reload that
 * finds the thread beside the block under the anchor the server minted.
 */
test('a commenter starts a thread from a block’s "+": hover, type, Post — the mark and the thread appear, and survive a reload', async ({ page, context }) => {
  await signInAs(context, fixtures.commenterSessionToken);

  await page.goto(pageUrl(seed.workspaceSlug, fixtures.freshPageId));
  await expect(page.getByRole('heading', { level: 1, name: fixtures.freshPageTitle })).toBeVisible({ timeout: 30000 });
  const paragraph = page.locator('article > p', { hasText: fixtures.freshFirstParagraph });
  await expect(paragraph).toHaveAttribute('data-derived-block-id', /^d:[0-9a-f]{12}#0$/);
  await expect(paragraph).not.toHaveAttribute('data-block-id', /.*/);

  // No thread yet, so no mark — but a "+" beside every paragraph, quiet
  // until its block is hovered, and a 24px target (§5).
  await expect(page.getByRole('button', { name: /^\d+ comments? on this block$/ })).toHaveCount(0);
  const starts = page.getByRole('button', { name: 'Comment on this block' });
  await expect(starts).toHaveCount(2);
  await expect(starts.first()).toHaveCSS('opacity', '0');
  await paragraph.hover();
  await expect(starts.first()).toHaveCSS('opacity', '1');
  const startBox = (await starts.first().boundingBox())!;
  expect(startBox.width).toBeGreaterThanOrEqual(24);
  expect(startBox.height).toBeGreaterThanOrEqual(24);
  await shot(page, 'read-hover-1280-light');

  await starts.first().click();
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  const composer = panel.getByTestId('comment-composer');
  await expect(composer).toContainText('On this block:');
  await expect(composer).toContainText(fixtures.freshFirstParagraph);
  await expect(panel.getByLabel('Comment', { exact: true })).toBeFocused();
  // Nothing typed: Post explains itself and stays in the tab order.
  await expect(panel.getByRole('button', { name: 'Post' })).toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'composer-1280-light');

  await panel.getByLabel('Comment', { exact: true }).fill('Started from read mode.');
  await panel.getByRole('button', { name: 'Post' }).click();

  // Optimistic, then confirmed: the composer closes, the live region
  // says so, the thread is in the panel, and the mark is beside the
  // block — placed under the anchor the server minted, before any reload.
  await expect(panel.getByRole('status').filter({ hasText: 'Comment posted.' })).toBeVisible({ timeout: 30000 });
  await expect(composer).toHaveCount(0);
  await expect(panel).toContainText('Started from read mode.');
  await expect(panel.getByTestId('comment-pending')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  const mark = page.getByRole('button', { name: '1 comment on this block' });
  await expect(mark).toBeVisible();
  await expect(paragraph).toHaveAttribute('data-block-id', /^[0-9A-Za-z]{10}$/);
  const paragraphBox = (await paragraph.boundingBox())!;
  const markBox = (await mark.boundingBox())!;
  expect(markBox.y).toBeGreaterThanOrEqual(paragraphBox.y - 1);
  expect(markBox.y).toBeLessThan(paragraphBox.y + paragraphBox.height);

  // Reload: the server's own render carries the persisted anchor, and
  // the thread stands beside its block with the block's text as excerpt.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: fixtures.freshPageTitle })).toBeVisible({ timeout: 30000 });
  const reloaded = page.getByRole('button', { name: '1 comment on this block' });
  await expect(reloaded).toBeVisible({ timeout: 30000 });
  await expect(page.locator('article > p', { hasText: fixtures.freshFirstParagraph })).toHaveAttribute('data-block-id', /^[0-9A-Za-z]{10}$/);
  await reloaded.click();
  await expect(dialog(page)).toContainText('Started from read mode.');
  await expect(dialog(page)).toContainText(fixtures.freshFirstParagraph);
  await expect(dialog(page).getByText(/^“.*”$/).first()).not.toContainText('^');
});

test('a commenter selects words inside a block and starts a thread on them — the thread carries the selection as its excerpt', async ({ page, context }) => {
  await signInAs(context, fixtures.commenterSessionToken);

  await page.goto(pageUrl(seed.workspaceSlug, fixtures.freshPageId));
  await expect(page.getByRole('heading', { level: 1, name: fixtures.freshPageTitle })).toBeVisible({ timeout: 30000 });
  const paragraph = page.locator('article > p', { hasText: fixtures.freshSecondParagraph });
  await expect(paragraph).toBeVisible();
  // The article is server-rendered, and hydration re-sets its `v-html`
  // (Vue patches a dynamic `innerHTML` while hydrating), which replaces
  // the text nodes a selection made before it was anchored in — the
  // browser collapses that selection, and no listener can bring it back.
  // So the selection below waits for the hydrated app, and for the "+"
  // that says the threads response has arrived and the caller may comment
  // (a selection made in *that* window is read once it may; the read
  // screen's unit suite holds it).
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: 'Comment on this block' })).toHaveCount(2, { timeout: 30000 });

  // Select "a few words" inside the second paragraph, by character offsets
  // of the real text node. A programmatic range fires `selectionchange` on
  // `document` exactly as a pointer drag does (both measured on
  // 2026-09-16, and the unit suite pins that `document` is what the screen
  // listens to); the range is used because it names the phrase.
  await paragraph.evaluate((element, phrase) => {
    const text = element.firstChild as Text;
    const start = text.data.indexOf(phrase);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + phrase.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, 'a few words');

  const action = page.getByTestId('comment-selection-action').getByRole('button', { name: 'Comment' });
  await expect(action).toBeVisible();
  // Beside the selection: inside the article's box, at the selected line.
  const actionBox = (await action.boundingBox())!;
  const paragraphBox = (await paragraph.boundingBox())!;
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(paragraphBox.y + paragraphBox.height + 48);
  expect(actionBox.y).toBeGreaterThanOrEqual(paragraphBox.y - 48);
  await shot(page, 'selection-1280-light');

  await action.click();
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  const composer = panel.getByTestId('comment-composer');
  await expect(composer).toContainText('On the selected text:');
  await expect(composer.getByTestId('comment-composer-excerpt')).toHaveText('“a few words”');
  await panel.getByLabel('Comment', { exact: true }).fill('These words specifically.');
  await panel.getByRole('button', { name: 'Post' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Comment posted.' })).toBeVisible({ timeout: 30000 });

  // The server located the words in the block's source: the excerpt the
  // thread keeps is the selection, not the whole paragraph.
  const thread = panel.locator('[data-comment-placement="anchored"]', { hasText: 'These words specifically.' });
  await expect(thread.locator('blockquote')).toHaveText('“a few words”');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: fixtures.freshPageTitle })).toBeVisible({ timeout: 30000 });
  await page.locator('article > p', { hasText: fixtures.freshSecondParagraph }).hover();
  await page.getByRole('button', { name: '1 comment on this block' }).last().click();
  await expect(dialog(page).locator('blockquote', { hasText: 'a few words' })).toHaveCount(1);
});

test('the gutter is one tab stop: the arrow keys move between the marks and the "+" slots, and Enter opens the composer', async ({ page, context }) => {
  await signInAs(context, fixtures.commenterSessionToken);

  await page.goto(pageUrl(seed.workspaceSlug, fixtures.commentsPageId));
  await expect(page.getByRole('heading', { level: 1, name: fixtures.commentsPageTitle })).toBeVisible({ timeout: 30000 });
  const gutter = page.getByRole('list', { name: 'Comments beside the text' });
  await expect(gutter).toBeVisible();
  const controls = gutter.getByRole('button');
  // Heading, three paragraphs: four slots, one of them the existing mark.
  await expect(controls).toHaveCount(4);

  // Tab lands on the gutter once; the rest of its controls are reached by
  // the arrow keys, never by another Tab.
  await controls.first().focus();
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(controls.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(controls.nth(3)).toBeFocused();
  await expect(controls.nth(3)).toHaveAccessibleName('Comment on this block');
  // A focused "+" is revealed, and Enter opens the composer on its block.
  await expect(controls.nth(3)).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByTestId('comment-composer')).toContainText('The third paragraph');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
});

test('at 320px the affordance fits the column and nothing scrolls sideways; in dark the composer reads', async ({ browser }) => {
  const narrow = await browser.newContext({ viewport: { width: 320, height: 900 } });
  const page = await narrow.newPage();
  await signInAs(narrow, fixtures.commenterSessionToken);
  await page.goto(pageUrl(seed.workspaceSlug, fixtures.commentsPageId));
  await expect(page.getByRole('heading', { level: 1, name: fixtures.commentsPageTitle })).toBeVisible({ timeout: 30000 });
  await expectNoHorizontalOverflow(page);
  await page.getByText('The first paragraph, which nobody has commented on.').hover();
  await shot(page, 'read-hover-320-light');
  await page.getByRole('button', { name: 'Comment on this block' }).first().click();
  await expect(dialog(page).getByTestId('comment-composer')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, 'composer-320-light');
  await narrow.close();

  const dark = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const darkPage = await dark.newPage();
  await useTheme(darkPage, 'dark');
  await signInAs(dark, fixtures.commenterSessionToken);
  await darkPage.goto(pageUrl(seed.workspaceSlug, fixtures.commentsPageId));
  await expect(darkPage.getByRole('heading', { level: 1, name: fixtures.commentsPageTitle })).toBeVisible({ timeout: 30000 });
  await darkPage.getByText('The first paragraph, which nobody has commented on.').hover();
  await shot(darkPage, 'read-hover-1280-dark');
  await darkPage.getByRole('button', { name: 'Comment on this block' }).first().click();
  await expect(dialog(darkPage).getByTestId('comment-composer')).toBeVisible();
  await shot(darkPage, 'composer-1280-dark');
  await dark.close();
});

/**
 * The block is deleted through the real edit screen by a second user's
 * session, not by a mock and not by calling `PUT /pages/:id` directly:
 * driving Save is what actually proves the edit screen's real save path,
 * and save-time reconciliation inside that same `savePage()` transaction
 * is what orphans the thread (comment-threads spec: "Tombstoned block
 * always orphans").
 *
 * Until this task, the edit screen could not save an existing page at
 * all: `GET /pages/:id/edit-session` carried no `contentHash`, so the
 * screen's first Save sent `expectedContentHash: null`, which
 * `savePage()` treats as a first save (`INSERT ... ON CONFLICT DO
 * NOTHING`) and refuses with 409 "Someone else saved a newer version" —
 * reproduced on 2026-09-14 and filed for docs/TODO.md, fixed by carrying
 * the hash through `useEditSession` into `edit.vue`. This test used to
 * work around that by calling `PUT /pages/:id` directly.
 */
test('a thread whose paragraph another user deleted is shown as orphaned, with its excerpt, never lost', async ({ browser }) => {
  // Context A: the editor removes the commented paragraph, for real,
  // through the edit screen.
  const editorContext = await browser.newContext();
  const editorPage = await editorContext.newPage();
  await signInAs(editorContext, fixtures.editorSessionToken);
  await editorPage.goto(pageEditUrl(seed.workspaceSlug, fixtures.orphanPageId));
  const editSurface = editorPage.getByTestId('editor-surface');
  await expect(editSurface).toBeVisible({ timeout: 30000 });
  await expect(editSurface).toContainText(fixtures.orphanQuote, { timeout: 30000 });

  const orphanParagraph = editSurface.locator('p', { hasText: fixtures.orphanQuote });
  await orphanParagraph.click({ clickCount: 3 });
  await editorPage.keyboard.press('Backspace');
  await editorPage.keyboard.press('Backspace');
  await expect(editSurface).not.toContainText(fixtures.orphanQuote);

  await editorPage.getByRole('button', { name: /Save/ }).click();
  await expect(editorPage.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 30000 });
  await editorContext.close();

  // Context B: the commenter reads the page. The paragraph is gone; the
  // thread is still there — as an orphan, in words, with the excerpt it
  // was written against.
  const readerContext = await browser.newContext();
  const readerPage = await readerContext.newPage();
  await signInAs(readerContext, fixtures.commenterSessionToken);
  await readerPage.goto(pageUrl(seed.workspaceSlug, fixtures.orphanPageId));
  await expect(readerPage.getByRole('heading', { level: 1, name: fixtures.orphanPageTitle })).toBeVisible({ timeout: 30000 });
  await expect(readerPage.getByText('The paragraph that stays.')).toBeVisible();
  await expect(readerPage.getByText(fixtures.orphanQuote)).toHaveCount(0);

  const chip = readerPage.getByTestId('comments-orphaned');
  await expect(chip).toBeVisible({ timeout: 30000 });
  await expect(chip).toContainText('1 comment points at text that is no longer on this page.');
  // No mark: there is no block for it to stand beside. (A "+" beside the
  // paragraph that stays is the commenter's, and is not a mark.)
  await expect(readerPage.getByRole('button', { name: /^\d+ comments? on this block$/ })).toHaveCount(0);

  await chip.getByRole('button', { name: 'Show' }).click();
  const panel = dialog(readerPage);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('1 no longer attached to text');
  await expect(panel.getByText('Text removed', { exact: true })).toBeVisible();
  await expect(panel).toContainText('no longer on this page');
  await expect(panel).toContainText(fixtures.orphanQuote);
  await expect(panel).toContainText('Keep this note even if the paragraph goes.');
  // Still a thread: it can be replied to and resolved.
  await expect(panel.getByRole('button', { name: 'Reply' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Resolve' })).toBeVisible();
  await readerContext.close();
});

test('a page whose cached render predates block anchors says its comment cannot be placed yet, and still shows it', async ({ page, context }) => {
  await signInAs(context, fixtures.commenterSessionToken);

  await page.goto(pageUrl(seed.workspaceSlug, fixtures.legacyPageId));
  await expect(page.getByRole('heading', { level: 1, name: fixtures.legacyPageTitle })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(fixtures.legacyQuote)).toBeVisible();
  // The pre-backfill render carries no anchor for the gutter to use — and
  // no derived id either, so nothing to start a thread on until the
  // backfill reaches this page.
  await expect(page.locator('[data-block-id]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /on this block$/ })).toHaveCount(0);

  const chip = page.getByTestId('comments-unplaced');
  await expect(chip).toBeVisible({ timeout: 30000 });
  await expect(chip).toContainText("1 comment can't be shown beside its text until this page is re-rendered.");

  await chip.getByRole('button', { name: 'Show' }).click();
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('1 not placed yet');
  await expect(panel.getByText('Not placed yet', { exact: true })).toBeVisible();
  await expect(panel).toContainText('re-rendered');
  await expect(panel).toContainText(fixtures.legacyQuote);
  await expect(panel).toContainText('This comment exists before the backfill has run.');
});

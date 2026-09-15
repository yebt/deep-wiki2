import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

  await page.goto(`/pages/${fixtures.commentsPageId}`);
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
  expect(Math.round(articleBox.x * 10) / 10, 'the column keeps its position').toBeCloseTo(310.5, 0);
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

  await page.goto(`/pages/${fixtures.commentsPageId}`);
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
  await editorPage.goto(`/pages/${fixtures.orphanPageId}/edit`);
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
  await readerPage.goto(`/pages/${fixtures.orphanPageId}`);
  await expect(readerPage.getByRole('heading', { level: 1, name: fixtures.orphanPageTitle })).toBeVisible({ timeout: 30000 });
  await expect(readerPage.getByText('The paragraph that stays.')).toBeVisible();
  await expect(readerPage.getByText(fixtures.orphanQuote)).toHaveCount(0);

  const chip = readerPage.getByTestId('comments-orphaned');
  await expect(chip).toBeVisible({ timeout: 30000 });
  await expect(chip).toContainText('1 comment points at text that is no longer on this page.');
  // No mark: there is no block for it to stand beside.
  await expect(readerPage.getByRole('button', { name: /on this block$/ })).toHaveCount(0);

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

  await page.goto(`/pages/${fixtures.legacyPageId}`);
  await expect(page.getByRole('heading', { level: 1, name: fixtures.legacyPageTitle })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(fixtures.legacyQuote)).toBeVisible();
  // The pre-backfill render carries no anchor for the gutter to use.
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

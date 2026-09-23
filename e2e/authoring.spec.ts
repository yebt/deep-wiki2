import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';
import { expectNoHorizontalOverflow } from './overflow';
import { pageUrl } from '../apps/web/app/utils/routes';

/**
 * The owner's three requests of 2026-09-23, driven end to end at every
 * width and theme the review gate asks for (docs/UI-CHECKLIST.md §4.2:
 * two contrasting themes, one of them dark; §6: 320px):
 *
 * 1. **Format**, in source mode, instead of a refusal that asks the person
 *    to be the formatter.
 * 2. **The page's title**, edited where it is read.
 * 3. **A toast**, in place of the status banner under the title.
 *
 * The three meet on one screen in that order — a page is edited, formatted,
 * saved, and then read and renamed — so one journey photographs all three
 * and asserts each one on the way, which is what keeps the screenshots
 * honest (this file's own review material is `authoring-*.png`, written
 * only when `DEEPWIKI_AUTHORING_SHOTS` names a directory).
 *
 * Against the real backend: a writer and an already-saved page from
 * `e2e/editor-fixtures.bun.ts`, the same pair `e2e/editor-source.spec.ts`
 * drives, because the claims here are about bytes that survive a save and
 * a rename that reaches the server.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });

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
const SHOTS = process.env.DEEPWIKI_AUTHORING_SHOTS ?? '';

let fixtures: EditorFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  fixtures = JSON.parse(output.trim().split('\n').pop()!);
});

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/authoring-${name}.png`, fullPage: false });
}

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

/** What the document is actually painted in, asserted beside every screenshot that claims a theme. */
async function expectTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /\blight\b/);
}

/** The three combinations the gate asks to see: two contrasting themes at 1280, and 320 in light. */
const CASES = [
  { label: '1280-light', width: 1280, theme: 'light' as const },
  { label: '1280-dark', width: 1280, theme: 'dark' as const },
  { label: '320-light', width: 320, theme: 'light' as const },
];

for (const shape of CASES) {
  test(`the formatter, the title and the toast at ${shape.label}`, async ({ page }) => {
    await page.setViewportSize({ width: shape.width, height: 900 });
    await signInAs(page, fixtures.writerSessionToken);
    await useTheme(page, shape.theme);

    /* ── 1. The refusal, with Format as its way out ──────────────────── */
    await page.goto(`${pageUrl(seed.workspaceSlug, fixtures.editablePageId)}/edit`);
    const bar = page.locator('#content-bar');
    await expect(page.getByTestId('editor-surface')).toBeVisible({ timeout: 120_000 });

    // Below `sm` the segmented control folds to one icon-only toggle.
    if (shape.width < 640) await bar.getByRole('button', { name: 'Source view' }).click();
    else await bar.getByRole('button', { name: 'Source' }).click();
    const source = page.getByTestId('editor-source');
    await expect(source).toBeFocused();

    const before = await source.inputValue();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nA *word* here.\n');
    await page.keyboard.press('Control+E');

    const refusal = page.getByTestId('editor-view-refusal');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('not in canonical form');
    await expect(refusal).toContainText('A *word* here.');
    await expect(refusal).toContainText('A _word_ here.');
    const format = refusal.getByRole('button', { name: 'Format' });
    await expect(format).toBeVisible();
    await expectNoHorizontalOverflow(page, `source refusal ${shape.label}`);
    // The screenshot claims a theme; assert it rather than trusting the
    // preference to have arrived (§4.2 asks for two contrasting themes,
    // and a shot that quietly came out in the other one proves nothing).
    await expectTheme(page, shape.theme);
    await shot(page, `source-format-${shape.label}`);

    // One click: the text becomes its canonical form and the visual view
    // opens on it.
    await format.click();
    await expect(page.getByTestId('editor-surface')).toBeVisible();
    // `.last()`: this file is serial and saves for real, so a run at the
    // next width finds the emphasis the previous one left on the page.
    await expect(page.getByTestId('editor-surface').locator('em').last()).toHaveText('word');
    await expect(refusal).toHaveCount(0);

    /* ── 2. The toast, in place of the banner under the title ────────── */
    const save = bar.getByRole('button', { name: /^Save/ });
    await expect(save).not.toHaveAttribute('aria-disabled');
    await save.click();
    const toast = page.getByRole('status').filter({ hasText: `Saved “${fixtures.editablePageTitle}”.` });
    await expect(toast).toBeVisible({ timeout: 60_000 });
    // It is dismissible, and it is not a banner in the document column.
    await expect(toast.getByRole('button', { name: /close/i })).toBeVisible();
    await expect(page.locator('#content-main')).not.toContainText('Saved “');
    await expectNoHorizontalOverflow(page, `saved toast ${shape.label}`);
    await expectTheme(page, shape.theme);
    await shot(page, `toast-${shape.label}`);

    // The bytes the source view showed are what was saved: read them back.
    await page.keyboard.press('Control+E');
    await expect(page.getByTestId('editor-source')).toHaveValue(`${before}\nA _word_ here.\n`);

    /* ── 3. The title, edited where the page is read ─────────────────── */
    await page.goto(pageUrl(seed.workspaceSlug, fixtures.editablePageId));
    await expect(page.getByRole('heading', { level: 1, name: fixtures.editablePageTitle })).toBeVisible({ timeout: 60_000 });
    // The heading above is in the document the *server* sent (the read
    // layer), and the control beside it with it — so a click before
    // hydration reaches nothing at all (`e2e/hydration.ts`, and the
    // management drawer that opened nothing on 2026-09-16).
    await waitForHydration(page);
    const renameControl = page.getByRole('button', { name: 'Rename this page' });
    await expect(renameControl).toBeAttached();
    await renameControl.click();
    const field = page.getByTestId('page-title-field');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(fixtures.editablePageTitle);
    // One `<h1>` in every state, the field inside it.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1').getByTestId('page-title-field')).toBeVisible();
    await expectNoHorizontalOverflow(page, `title editing ${shape.label}`);
    await expectTheme(page, shape.theme);
    await shot(page, `title-${shape.label}`);

    // Escape writes nothing and hands focus back to the control that asked.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('page-title-field')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: fixtures.editablePageTitle })).toBeVisible();
    await expect(renameControl).toBeFocused();
  });
}

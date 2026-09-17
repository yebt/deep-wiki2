import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './overflow';

/**
 * Edit mode's surface after the owner's 2026-09-17 decisions: no frame
 * around the document, and source mode (`Ctrl`/`⌘`+`E`) beside the live
 * view. Real backend throughout — a writer and one already-saved page
 * minted by `e2e/editor-fixtures.bun.ts`, saved bytes read back through
 * a fresh edit session — because the claims here are about bytes that
 * survive the round trip and a mock cannot be trusted with those
 * (e2e/editor.spec.ts, the Save test's own note).
 *
 * The screenshots (`fb-editor2-*.png`, `DEEPWIKI_FRAME_SHOTS`) are the
 * owner's review material; the assertions are what keeps them honest.
 */

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
const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

let editorFixtures: EditorFixtures;

test.beforeAll(() => {
  const output = execFileSync('bun', ['run', 'e2e/editor-fixtures.bun.ts', seed.workspaceId], { cwd: REPO_ROOT, encoding: 'utf8' });
  editorFixtures = JSON.parse(output.trim().split('\n').pop()!);
});

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-editor2-${name}.png`, fullPage: false });
}

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

/** The computed value of a theme variable, read the way `e2e/perf.spec.ts` reads `--ui-primary`. */
async function themeColour(page: Page, variable: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, variable);
}

/** See e2e/editor.spec.ts `caretToEnd`: click at the last block's right edge and wait for ProseMirror to read the caret. */
async function caretToEnd(editor: Locator): Promise<void> {
  const before = (await editor.getAttribute('data-transactions')) ?? '0';
  const last = editor.locator(':scope > *').last();
  const box = await last.boundingBox();
  if (!box) throw new Error('caretToEnd: the editor has no block to click');
  await last.click({ position: { x: Math.max(1, box.width - 2), y: box.height / 2 } });
  await expect(editor, 'ProseMirror has read the caret the click placed').not.toHaveAttribute('data-transactions', before);
}

async function openEditor(page: Page): Promise<Locator> {
  await page.goto(`/pages/${editorFixtures.editablePageId}/edit`);
  const editor = page.getByTestId('editor-surface');
  await expect(editor).toContainText(editorFixtures.editablePageMarkdown.trim(), { timeout: 30000 });
  return editor;
}

/**
 * The owner's screenshot (2026-09-17): a rounded box hugging the
 * content, fighting the block handle in the margin. It was the global
 * focus indicator — 3px `secondary` at 2px offset — landing on the
 * contenteditable, which Chrome treats as focus-visible on every focus,
 * pointer included. A document is not a control: the caret is its focus
 * indicator (WCAG 2.4.7 counts the text cursor for a text field), drawn
 * in the `primary` role the M3 text field gives its caret, so the
 * indicator is relocated, never removed (checklist §5).
 */
for (const theme of ['light', 'dark'] as const) {
  test.describe(`the surface draws no frame, 1280x900 ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('a focused editor carries no outline and no rounded box; its caret is the primary role', async ({ page }) => {
      test.setTimeout(90000);
      await signInAs(page, editorFixtures.writerSessionToken);
      await useTheme(page, theme);
      const editor = await openEditor(page);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

      await caretToEnd(editor);
      await expect(editor).toBeFocused();
      const style = await editor.evaluate((el) => {
        const computed = getComputedStyle(el);
        return {
          outlineStyle: computed.outlineStyle,
          outlineWidth: computed.outlineWidth,
          borderWidth: computed.borderWidth,
          boxShadow: computed.boxShadow,
          borderRadius: computed.borderRadius,
          caretColor: computed.caretColor,
          whiteSpace: computed.whiteSpace,
        };
      });
      expect(style.outlineStyle, 'no focus outline around the document').toBe('none');
      expect(style.borderWidth).toBe('0px');
      expect(style.boxShadow).toBe('none');
      expect(style.borderRadius, 'nothing is drawn, so nothing is rounded').toBe('0px');
      expect(style.caretColor).toBe(await themeColour(page, '--ui-primary'));
      // prosemirror-view's structural stylesheet is loaded (main.css §13):
      // under `white-space: normal` a trailing space is collapsible and
      // Chrome rewrites the text node around it (found 2026-09-17).
      expect(style.whiteSpace).toBe('break-spaces');

      // The measure column is untouched: the first paragraph stands where
      // read mode's does (e2e/editor.spec.ts holds the two to the pixel;
      // this only confirms the surface itself did not move).
      const paragraph = (await editor.locator(':scope > p').first().boundingBox())!;
      const title = (await page.getByRole('main').getByRole('heading', { level: 1 }).boundingBox())!;
      expect(Math.abs(paragraph.x - title.x), `paragraph x ${paragraph.x} vs title x ${title.x}`).toBeLessThanOrEqual(1);

      await expectNoHorizontalOverflow(page, `edit surface 1280 ${theme}`);
      await shot(page, `surface-1280-${theme}`);
    });
  });
}

test.describe('the surface draws no frame, 320x900', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('nothing scrolls sideways with the editor focused', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'light');
    const editor = await openEditor(page);
    await caretToEnd(editor);
    await expect(editor).toHaveCSS('outline-style', 'none');
    await expectNoHorizontalOverflow(page, 'edit surface 320');
    await shot(page, 'surface-320-light');
  });
});

/**
 * The inline shortcuts the pipeline already parses (owner decision,
 * 2026-09-17), typed through a real keyboard: `~~x~~`, `*x*`, `__x__`,
 * `[text](url)` and a bare URL closed by a space. The unit suite holds
 * each rule's transaction and its round trip; this holds the one thing
 * it cannot — that the typed closing character reaches the rule through
 * ProseMirror's own input handling, and that the space after a bare URL
 * is still there to keep typing after.
 */
test.describe('live input rules', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('typing the markdown spellings renders the marks in place, and the bare URL keeps its trailing space', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'light');
    const editor = await openEditor(page);
    await caretToEnd(editor);

    await page.keyboard.type(' ~~gone~~ *soft* __loud__ [docs](https://example.com/docs) https://example.com/bare next');
    const paragraph = editor.locator(':scope > p').first();
    await expect(paragraph.locator('del')).toHaveText('gone');
    await expect(paragraph.locator('em')).toHaveText('soft');
    await expect(paragraph.locator('strong')).toHaveText('loud');
    await expect(paragraph.locator('a[href="https://example.com/docs"]')).toHaveText('docs');
    await expect(paragraph.locator('a[href="https://example.com/bare"]')).toHaveText('https://example.com/bare');
    // The punctuation is consumed; the words and the space after the URL are not.
    await expect(paragraph).toHaveText(`${editorFixtures.editablePageMarkdown.trim()} gone soft loud docs https://example.com/bare next`);
  });
});

/**
 * Source mode (owner decision, 2026-09-17, "like Obsidian"): `Ctrl`/`⌘`+`E`
 * swaps the live document for its markdown and back, losslessly; the
 * edit session's buffer is the truth in either view, and Save reads it
 * from either. The bytes are proved the only way that means anything —
 * saved for real and read back through a fresh edit session — and the
 * refusal of a non-canonical source is proved by the source staying
 * exactly as typed.
 */
test.describe('source mode', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('type in visual, toggle, see the markdown, edit in source, toggle back, save: the saved bytes are what source showed', async ({ page }) => {
    test.setTimeout(120000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'light');
    const editor = await openEditor(page);
    const bar = page.locator('#content-bar');
    const visualButton = bar.getByRole('button', { name: 'Visual' });
    const sourceButton = bar.getByRole('button', { name: 'Source' });
    await expect(visualButton).toHaveAttribute('aria-pressed', 'true');
    await expect(sourceButton).toHaveAttribute('aria-pressed', 'false');

    await caretToEnd(editor);
    await page.keyboard.type(' Typed in the visual view.');
    await page.keyboard.press('Control+E');

    // The markdown of the document as it stands — the visual view's
    // last 300ms are flushed on the way out.
    const source = page.getByTestId('editor-source');
    await expect(source).toBeVisible();
    await expect(source).toBeFocused();
    await expect(source).toHaveValue(`${editorFixtures.editablePageMarkdown.trim()} Typed in the visual view.\n`);
    await expect(editor).toHaveCount(0);
    await expect(sourceButton).toHaveAttribute('aria-pressed', 'true');
    await expect(visualButton).toHaveAttribute('aria-pressed', 'false');
    await expect(bar.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    // The source surface, like the visual one, draws no frame, and its
    // first character stands where the visual view's did.
    await expect(source).toHaveCSS('outline-style', 'none');
    const sourceBox = (await source.boundingBox())!;
    const title = (await page.getByRole('main').getByRole('heading', { level: 1 }).boundingBox())!;
    expect(Math.abs(sourceBox.x + 16 - title.x), `source text x ${sourceBox.x + 16} vs title x ${title.x}`).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page, 'source view 1280 light');
    await shot(page, 'source-1280-light');

    // Edit in source: a new paragraph, indented two spaces by Tab inside a list.
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n- a list\n');
    await page.keyboard.press('Tab');
    await page.keyboard.type('- nested, indented by Tab\n');
    const expectedSource = `${editorFixtures.editablePageMarkdown.trim()} Typed in the visual view.\n\n- a list\n  - nested, indented by Tab\n`;
    await expect(source).toHaveValue(expectedSource);

    await page.keyboard.press('Control+E');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('nested, indented by Tab');
    await expect(editor.locator('ul ul li')).toHaveText('nested, indented by Tab');
    await expect(visualButton).toHaveAttribute('aria-pressed', 'true');

    const save = bar.getByRole('button', { name: /^Save/ });
    await expect(save).not.toHaveAttribute('aria-disabled');
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 30000 });

    // Read back through a fresh edit session, then shown as source: the
    // bytes on the row are the bytes the source view showed.
    await page.reload();
    const reloaded = page.getByTestId('editor-surface');
    await expect(reloaded).toContainText('nested, indented by Tab', { timeout: 30000 });
    await page.keyboard.press('Control+E');
    await expect(page.getByTestId('editor-source')).toHaveValue(expectedSource);
  });

  test('a non-canonical source is refused: the view stays, the text is untouched, and the notice names the line by its two spellings', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'light');
    await openEditor(page);
    const bar = page.locator('#content-bar');

    await bar.getByRole('button', { name: 'Source' }).click();
    const source = page.getByTestId('editor-source');
    await expect(source).toBeFocused();
    // The page as the previous test left it — this file is serial and
    // saves for real — so the expectations are built from what is shown.
    const initial = await source.inputValue();
    expect(initial.endsWith('\n')).toBe(true);
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nSay **bold** here.\n');
    const typed = `${initial}\nSay **bold** here.\n`;
    await expect(source).toHaveValue(typed);
    const offendingLine = initial.split('\n').length + 1;

    await page.keyboard.press('Control+E');
    const notice = page.getByRole('alert').filter({ hasText: /not in canonical form/ });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`Line ${offendingLine}`);
    await expect(notice).toContainText('Say **bold** here.');
    await expect(notice).toContainText('Say __bold__ here.');
    await expect(source).toHaveValue(typed);
    await expect(page.getByTestId('editor-surface')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page, 'source refusal 1280 light');
    await shot(page, 'source-refused-1280-light');

    // Written the canonical way, the same key opens the visual view.
    await source.fill(`${initial}\nSay __bold__ here.\n`);
    await page.keyboard.press('Control+E');
    await expect(page.getByTestId('editor-surface')).toBeVisible();
    await expect(page.getByTestId('editor-surface').locator('strong')).toHaveText('bold');
    await expect(notice).toHaveCount(0);
  });

  test('the choice persists per browser: a reload opens in the source view', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'dark');
    await openEditor(page);
    await page.locator('#content-bar').getByRole('button', { name: 'Source' }).click();
    await expect(page.getByTestId('editor-source')).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expectNoHorizontalOverflow(page, 'source view 1280 dark');
    await shot(page, 'source-1280-dark');
    const shown = await page.getByTestId('editor-source').inputValue();

    await page.reload();
    await expect(page.getByTestId('editor-source')).toHaveValue(shown, { timeout: 30000 });
    await expect(page.getByTestId('editor-surface')).toHaveCount(0);
  });
});

test.describe('source mode, 320x900', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('the bar holds the view control with the rest, and nothing scrolls sideways', async ({ page }) => {
    test.setTimeout(90000);
    await signInAs(page, editorFixtures.writerSessionToken);
    await useTheme(page, 'light');
    await openEditor(page);
    const bar = page.locator('#content-bar');
    await page.keyboard.press('Control+E');
    await expect(page.getByTestId('editor-source')).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Save/ })).toBeVisible();
    // Below `sm` the segmented control gives way to one icon-only toggle
    // (named, tooltipped, pressed while source is up — §4.3, §5) so the
    // one crumb shown is still whole: the same measurement
    // e2e/editor.spec.ts makes of the bar at 320, with the crumb's own
    // box included.
    const crumb = page.getByRole('navigation', { name: 'Where you are' }).getByRole('listitem').last();
    await expect(crumb).toHaveText('Editing');
    const clipped = await crumb.evaluate((el) => [el, ...Array.from(el.querySelectorAll('*'))].some((node) => node.scrollWidth > node.clientWidth + 1));
    expect(clipped, 'the Editing crumb is not truncated').toBe(false);
    await expect(bar.getByRole('button', { name: 'Visual' })).toBeHidden();
    const toggle = bar.getByRole('button', { name: 'Source view' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(page.getByTestId('editor-surface')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(bar.getByRole('button', { name: 'Undo' })).toBeVisible();
    const clippedVisual = await crumb.evaluate((el) => [el, ...Array.from(el.querySelectorAll('*'))].some((node) => node.scrollWidth > node.clientWidth + 1));
    expect(clippedVisual, 'the Editing crumb is not truncated beside Undo and Redo either').toBe(false);
    await toggle.click();
    await expect(page.getByTestId('editor-source')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'source view 320');
    await shot(page, 'source-320-light');
  });
});

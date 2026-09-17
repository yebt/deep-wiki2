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
        };
      });
      expect(style.outlineStyle, 'no focus outline around the document').toBe('none');
      expect(style.borderWidth).toBe('0px');
      expect(style.boxShadow).toBe('none');
      expect(style.borderRadius, 'nothing is drawn, so nothing is rounded').toBe('0px');
      expect(style.caretColor).toBe(await themeColour(page, '--ui-primary'));

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

import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { boundaryContrast } from './contrast';
import { pageCommentsAnswered, waitForHydration } from './hydration';
import { expectNoHorizontalOverflow } from './overflow';
import { pageHistoryUrl, pageUrl } from '../apps/web/app/utils/routes';

/**
 * Read mode (document-modes spec: "Read Mode Serves Pre-Rendered HTML
 * Without Reparsing"; page-content spec: "Read mode request returns
 * cached HTML"). Against a real, freshly seeded backend
 * (e2e/global-setup.ts) — a real page with real saved content, a reader
 * who can see it, and an outsider who cannot.
 *
 * Sessions are minted directly in the seed rather than driven through the
 * sign-in UI: this suite exercises the read route, not authentication
 * (e2e/auth.spec.ts's job). `localhost:<web port>` and `localhost:<api
 * port>` are different origins but the same *site* (same scheme, same
 * host, only the port differs) — a `SameSite=Lax` cookie scoped to the
 * bare `localhost` host is sent on both, exactly as it is once a real
 * sign-in sets it.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly readPageId: string;
  readonly workspaceSlug: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

// Serial, not parallel: both tests navigate to the same on-demand-compiled
// dev-server route, and under load two simultaneous first-compiles of the
// same page were measurably slower than one followed by an already-warm
// second (see docs/TODO.md's general 4-core-under-load note).
test.describe.configure({ mode: 'serial' });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

test('a reader sees the cached content, and the response never reaches the ProseMirror/Milkdown bundle', async ({ page, context }) => {
  // The budget the rest of this file already takes (and for the same
  // reason: a dev-server first compile on a loaded host). This test waits
  // for hydration since 2026-09-23, and hydration is the slow half — it
  // timed out at the 30s default on a four-core host at load average 25
  // while nothing about the screen was wrong (2026-09-23).
  test.setTimeout(240_000);
  await signInAs(context, fixtures.readerSessionToken);

  const editorRequests: string[] = [];
  page.on('request', (request) => {
    if (/prosemirror|milkdown|tiptap/i.test(request.url())) editorRequests.push(request.url());
  });

  await page.goto(pageUrl(fixtures.workspaceSlug, fixtures.readPageId));

  // A generous timeout on the first assertion only: the dev server
  // compiles this route on first visit, which under load can take longer
  // than Playwright's 5s default — everything after this is already warm.
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Read Page' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Read mode serves this exact content, cached, without reparsing.')).toBeVisible();
  // The three assertions above are satisfied by the document the *server*
  // sent, so without this wait the request log below is read a twelfth of
  // the way through the client's module graph — measured on 2026-09-23,
  // 45 client requests at that point against 566 once hydration had
  // finished. The editor bundle is reached by a dynamic import the client
  // makes, which is exactly the half that window was skipping
  // (docs/TODO.md Findings, 2026-09-23).
  await waitForHydration(page);
  expect(editorRequests).toEqual([]);
});

test('an outsider with no read grant sees a coherent permission-denied state, not a crash or an empty page', async ({ page, context }) => {
  test.setTimeout(240_000);
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(pageUrl(fixtures.workspaceSlug, fixtures.readPageId));

  await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('E2E Read Page')).toHaveCount(0);
  // No inert "Edit" link offering an action the next screen would only refuse.
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
});

/**
 * Nuxt's colour mode is class-driven (`.dark` on `<html>`, docs/DESIGN-SYSTEM.md
 * §0) and persisted under `nuxt-color-mode`; setting it before hydration
 * is what the header's toggle does, without a round trip through the UI.
 */
async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('nuxt-color-mode', value), theme);
}

for (const theme of ['light', 'dark'] as const) {
  // The 2026-09-14 audit measured the app bar's "Edit" at 1.09:1 against
  // the bar behind it: `variant="soft"` is `primary-container` (tone 90),
  // the bar is `bg-elevated` (tone 94), and a fill four tones from its
  // ground has no visible edge. §5 fixes the boundary of an interactive
  // control at 3:1, in every theme. A control that passes only in one is a
  // §4.2 failure as well.
  test(`the app bar's Edit control has a boundary of at least 3:1 against the bar, in the ${theme} theme`, async ({ page, context }) => {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, theme);

    await page.goto(pageUrl(fixtures.workspaceSlug, fixtures.readPageId));
    const edit = page.getByRole('link', { name: 'Edit' });
    await expect(edit).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);

    expect(await boundaryContrast(edit)).toBeGreaterThanOrEqual(3);
  });
}

/**
 * §3: the skeleton occupies the loaded box — measured, not assumed.
 * On 2026-09-14 the read skeleton put its first "paragraph" line 24px
 * under a 36px title (`h-9` + `mt-6`), where the loaded screen puts its
 * first paragraph 32px under the `h1` (`PageHeading`'s `mb-8`), on 26px
 * `doc-body` lines rather than 16px ones. happy-dom has no layout engine,
 * so this file is the owner: hold the response, measure, release, measure.
 *
 * The page is reached by a client-side navigation (from its history
 * screen, through "Read page"): a full load is answered on the server
 * since the data layer (`useApiRead`) — the article is in the document
 * and no skeleton ever shows, which `e2e/data-layer.spec.ts` holds. The
 * skeleton is for a page the browser has not seen yet, and that is the
 * hop this test makes.
 */
test('the read skeleton occupies the box the loaded document takes: title and first paragraph line up', async ({ page, context }) => {
  // Waits for hydration before the hop (below): dev mode under load.
  test.setTimeout(240_000);
  await signInAs(context, fixtures.readerSessionToken);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${fixtures.apiUrl}/pages/${fixtures.readPageId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await held;
    await route.continue();
  });

  await page.goto(pageHistoryUrl(fixtures.workspaceSlug, fixtures.readPageId));
  await waitForHydration(page);
  await page.getByRole('link', { name: 'Read page', exact: true }).click({ timeout: 30000 });
  const skeleton = page.getByTestId('read-skeleton');
  await expect(skeleton).toBeVisible({ timeout: 30000 });
  const skeletonTitle = (await skeleton.getByTestId('read-skeleton-title').boundingBox())!;
  const skeletonLine = (await skeleton.getByTestId('read-skeleton-line').first().boundingBox())!;

  release();
  const title = page.getByRole('heading', { level: 1, name: 'E2E Read Page' });
  await expect(title).toBeVisible({ timeout: 30000 });
  const loadedTitle = (await title.boundingBox())!;
  // The article's first block, whatever the document opens with (the
  // fixture opens with an `h2`): the skeleton cannot know the shape of
  // prose it has not received, only where the prose starts and how tall a
  // body line is.
  const loadedFirstBlock = (await page.locator('article > *').first().boundingBox())!;
  const loadedParagraphLine = await page.locator('article p').first().evaluate((p) => Number.parseFloat(getComputedStyle(p).lineHeight));

  expect(Math.abs(skeletonTitle.y - loadedTitle.y), `title top: skeleton ${skeletonTitle.y}, loaded ${loadedTitle.y}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonTitle.height - loadedTitle.height), `title height: skeleton ${skeletonTitle.height}, loaded ${loadedTitle.height}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonLine.y - loadedFirstBlock.y), `first line top: skeleton ${skeletonLine.y}, loaded ${loadedFirstBlock.y}`).toBeLessThanOrEqual(1);
  // A skeleton line is one `doc-body` line box — 26px — not a 16px bar.
  expect(Math.abs(skeletonLine.height - loadedParagraphLine), `line box: skeleton ${skeletonLine.height}, prose ${loadedParagraphLine}`).toBeLessThanOrEqual(1);
});


/**
 * The comments toggle (docs/UI-CHECKLIST.md Review Log, 2026-09-15: "the
 * comments on the document should also be toggleable"). A display
 * preference for someone who can comment, against a real backend: the
 * commenter, the threads and the page are minted by
 * `e2e/comments-fixtures.bun.ts`, as in `e2e/comments.spec.ts`, and the
 * mention that puts a number on the toggle is a real reply posted through
 * the panel — `@E2E Commenter` in a body is what the activity query reads.
 *
 * Two things a component test cannot hold are held here: that the marks
 * and the badge are what the browser shows after a reload (the cookie),
 * and — the invariant — that a read-only caller, whichever way the
 * preference points, sees no toggle and no marks, because the API still
 * answers them `{ threads: [] }` and the client still draws nothing.
 */
interface CommentFixtures {
  readonly commenterSessionToken: string;
  readonly commentsPageId: string;
  readonly commentsPageTitle: string;
}

const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/frame2-${name}.png`, fullPage: false });
}

test.describe('the comments toggle', () => {
  let comments: CommentFixtures;

  test.beforeAll(async () => {
    const { execFileSync } = await import('node:child_process');
    const { join } = await import('node:path');
    const seed: { workspaceId: string } = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));
    const output = execFileSync('bun', ['run', 'e2e/comments-fixtures.bun.ts', seed.workspaceId], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, CHANGESET_WINDOW_MINUTES: '30' },
    });
    comments = JSON.parse(output.trim().split('\n').pop()!);
  });

  for (const theme of ['light', 'dark'] as const) {
    test.describe(`1280x900 ${theme}`, () => {
      test.use({ viewport: { width: 1280, height: 900 } });

      test('a commenter hides the marks; while hidden the toggle counts the open threads that mention them; the choice survives a reload', async ({
        page,
        context,
      }) => {
        // Two full loads, each waiting for hydration: dev mode under load.
        test.setTimeout(240_000);
        await signInAs(context, comments.commenterSessionToken);
        await useTheme(page, theme);

        await page.goto(pageUrl(fixtures.workspaceSlug, comments.commentsPageId));
        await expect(page.getByRole('heading', { level: 1, name: comments.commentsPageTitle })).toBeVisible({ timeout: 30000 });
        const mark = page.getByRole('button', { name: /comments? on this block$/ });
        await expect(mark).toBeVisible({ timeout: 30000 });

        // A real mention, posted through the panel, so the count below is
        // the server's answer and not a fixture's.
        await mark.click();
        const panel = page.getByRole('dialog', { name: 'Comments' });
        await expect(panel).toBeVisible();
        await panel.getByLabel('Reply').fill('@E2E Commenter please confirm the date.');
        await panel.getByRole('button', { name: 'Reply' }).click();
        await expect(panel.getByRole('status').filter({ hasText: 'Reply posted.' })).toBeVisible({ timeout: 30000 });
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();

        // Hide: the marks go, the toggle says what is hidden and how many
        // threads name the person, and the change is announced.
        const hide = page.getByRole('button', { name: 'Hide comments' });
        await expect(hide).toBeVisible();
        await hide.click();
        await expect(page.getByRole('button', { name: /on this block$/ })).toHaveCount(0);
        const show = page.getByRole('button', { name: 'Show comments — 1 open thread mentions you' });
        await expect(show).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('comments-mention-badge')).toHaveText('1');
        await expect(page.getByRole('status').filter({ hasText: 'Comments hidden.' })).toHaveCount(1);
        // The article keeps its measure: the marks stood outside it.
        const article = (await page.locator('article').boundingBox())!;
        expect(Math.round(article.width * 10) / 10).toBeCloseTo(658.9, 0);

        await shot(page, `read-comments-hidden-1280-${theme}`);

        // Remembered.
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: comments.commentsPageTitle })).toBeVisible({ timeout: 30000 });
        // The article is server-rendered now; the count on the toggle needs
        // the hydrated app to have fetched the threads.
        await waitForHydration(page);
        await expect(page.getByRole('button', { name: /on this block$/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Show comments — 1 open thread mentions you' })).toBeVisible({ timeout: 30000 });

        // And back: the one mark returns. Counted by the marks' own name
        // (`N comment(s) on this block`) — since 2026-09-16 every block a
        // commenter can start a thread on also carries a "Comment on this
        // block" slot, which `/on this block$/` would count with them.
        await page.getByRole('button', { name: /^Show comments/ }).click();
        await expect(page.getByRole('button', { name: /\d+ comments? on this block$/ })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Hide comments' })).toBeVisible();
        await expect(page.getByTestId('comments-mention-badge')).toHaveCount(0);
      });
    });
  }

  test.describe('320x900 light, the document alone', () => {
    test.use({ viewport: { width: 320, height: 900 } });

    test('hidden comments, focus mode persisted: the badge still counts, nothing scrolls sideways', async ({ page, context }) => {
      await signInAs(context, comments.commenterSessionToken);
      await useTheme(page, 'light');
      await context.addCookies([
        { name: 'dw-comments', value: 'hidden', domain: 'localhost', path: '/' },
        { name: 'dw-frame-sidebar-workspace', value: encodeURIComponent(JSON.stringify({ size: 17.5, collapsed: true })), domain: 'localhost', path: '/' },
      ]);

      await page.goto(pageUrl(fixtures.workspaceSlug, comments.commentsPageId));
      await expect(page.getByRole('heading', { level: 1, name: comments.commentsPageTitle })).toBeVisible({ timeout: 30000 });
      // The toggle first: the heading above is the server's, and the
      // toggle is the only thing here that proves the client has hydrated
      // *and* the thread fetch has answered. Asserted the other way round,
      // the absence below held on a commented page with its marks shown —
      // proved by running it that way on 2026-09-23 (docs/TODO.md
      // Findings): a mark's absence read before the client draws is an
      // absence on every page, for every caller.
      await expect(page.getByRole('button', { name: /^Show comments — \d+ open thread/ })).toBeVisible({ timeout: 30000 });
      await expect(page.getByRole('button', { name: /on this block$/ })).toHaveCount(0);
      await expectNoHorizontalOverflow(page, 'read comments hidden 320');

      await shot(page, 'read-comments-hidden-320-light');
    });
  });

  test.describe('the read-only invariant', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    for (const preference of ['hidden', 'shown'] as const) {
      test(`a reader with read but not comment gets no toggle and no marks with the preference "${preference}"`, async ({ page, context }) => {
        await signInAs(context, fixtures.readerSessionToken);
        await context.addCookies([{ name: 'dw-comments', value: preference, domain: 'localhost', path: '/' }]);

        // Registered before the navigation (`pageCommentsAnswered`'s note).
        const commentsAnswered = pageCommentsAnswered(page);
        await page.goto(pageUrl(fixtures.workspaceSlug, comments.commentsPageId));
        await expect(page.getByRole('heading', { level: 1, name: comments.commentsPageTitle })).toBeVisible({ timeout: 30000 });
        // Every absence below is an absence *after* the client has drawn
        // what it draws: the marks and the toggle are not in the document
        // the server sent, so without this wait the whole test passes
        // vacuously on any page (docs/TODO.md Findings, 2026-09-23).
        await waitForHydration(page);
        // Hydration alone is not enough either: the gutter is drawn from
        // `GET /pages/:id/comments`, and this screen — whose whole claim
        // is that nothing is drawn — offers no positive that answer must
        // have produced. The response is the signal.
        await commentsAnswered;

        await expect(page.locator('[data-block-id="E2ECMTTWO"]')).toHaveCount(1);
        await expect(page.getByRole('button', { name: /on this block$/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^(Hide|Show) comments/ })).toHaveCount(0);
        expect(await page.content()).not.toContain('Is this paragraph still accurate');
      });
    }
  });
});

/* ────────────────────────────────────────────────────────────────────
 * The owner's two reports, 2026-09-23: task lists "not properly
 * supported", and code blocks with no syntax highlighting.
 *
 * Both are properties of what READ MODE serves, which is the cached,
 * sanitised `page_content.rendered_html` written at save time — so the
 * seeded page below goes through the real `savePage()` and these tests
 * measure the real cached bytes in a real browser, not a fixture built
 * beside them. The md-prefixed screenshots are the owner's review
 * material.
 * ──────────────────────────────────────────────────────────────────── */

const MD_SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

async function mdShot(page: Page, name: string): Promise<void> {
  if (!MD_SHOTS) return;
  await page.screenshot({ path: `${MD_SHOTS}/md-${name}.png`, fullPage: false });
}

interface MarkdownFixtures {
  readonly markdownPageId: string;
}

const markdownFixtures: MarkdownFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

test.describe('task lists and highlighted code on the read screen', () => {
  async function openMarkdownPage(page: Page, context: BrowserContext, theme: 'light' | 'dark'): Promise<void> {
    await signInAs(context, fixtures.readerSessionToken);
    await useTheme(page, theme);
    await page.goto(pageUrl(fixtures.workspaceSlug, markdownFixtures.markdownPageId));
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Markdown Page' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`a fenced block carries highlight spans and reads correctly in the ${theme} theme`, async ({ page, context }) => {
      await openMarkdownPage(page, context, theme);

      const fence = page.locator('article pre').first();
      await expect(fence).toBeVisible();

      // The colouring is classes, never inline style: that is what makes a
      // theme switch a stylesheet change rather than a re-render of every
      // cached page.
      await expect(fence.locator('.hl-keyword').first()).toBeVisible();
      await expect(fence.locator('.hl-comment').first()).toHaveText('// a comment');
      await expect(fence.locator('[style]')).toHaveCount(0);

      // The code still READS — highlighting must not eat, reorder or
      // duplicate a character of it.
      await expect(fence).toContainText("const greeting: string = 'hello'; // a comment");
      await expect(fence).toContainText('export function greet(name: string): string {');

      // Every token is legible against the block it sits on: §5's 4.5:1
      // body-text floor, measured in the running browser in both themes
      // rather than argued from the tone table.
      const ratios = await fence.evaluate((pre) => {
        function parse(colour: string): [number, number, number] {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context2d = canvas.getContext('2d')!;
          context2d.fillStyle = colour;
          context2d.fillRect(0, 0, 1, 1);
          const [r, g, b] = context2d.getImageData(0, 0, 1, 1).data;
          return [r!, g!, b!];
        }
        function luminance(rgb: [number, number, number]): number {
          const [r, g, b] = rgb.map((channel) => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          }) as [number, number, number];
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        const background = luminance(parse(getComputedStyle(pre).backgroundColor));
        return [...pre.querySelectorAll('span[class^="hl-"]')]
          .filter((span) => (span.textContent ?? '').trim().length > 0)
          .map((span) => {
            const foreground = luminance(parse(getComputedStyle(span).color));
            const [light, dark] = foreground > background ? [foreground, background] : [background, foreground];
            return (light + 0.05) / (dark + 0.05);
          });
      });

      expect(ratios.length).toBeGreaterThan(3);
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);

      await expectNoHorizontalOverflow(page, `markdown page 1280 ${theme}`);
      await mdShot(page, `read-1280-${theme}`);
    });

    test(`a task list renders as checkboxes, inert but legible, in the ${theme} theme`, async ({ page, context }) => {
      await openMarkdownPage(page, context, theme);

      const boxes = page.locator('article li.task-list-item input[type="checkbox"]');
      await expect(boxes).toHaveCount(2);

      // Read mode serves cached HTML and has no write path, so an
      // enabled-looking box that did nothing would be checklist §6's
      // "no inert interactions" failure. Inert, and still legible as done
      // or not done — which is the only thing a reader came to the list
      // for (docs/UI-CHECKLIST.md §5: colour is never the sole carrier;
      // the box's fill and its tick are the signal, not a hue).
      await expect(boxes.nth(0)).toBeDisabled();
      await expect(boxes.nth(1)).toBeDisabled();
      await expect(boxes.nth(0)).not.toBeChecked();
      await expect(boxes.nth(1)).toBeChecked();

      // The list marker is gone where a box replaced it, and only there:
      // the plain bullet in the same list keeps its disc.
      const markers = await page.locator('article li').evaluateAll((items) =>
        items.map((item) => ({ marker: getComputedStyle(item).listStyleType, task: item.classList.contains('task-list-item') })),
      );
      expect(markers.filter((item) => item.task).every((item) => item.marker === 'none')).toBe(true);
      expect(markers.filter((item) => !item.task).every((item) => item.marker === 'disc')).toBe(true);

      // A ticked box and an unticked one are drawn differently, not merely
      // labelled differently.
      const fills = await boxes.evaluateAll((inputs) => inputs.map((input) => getComputedStyle(input).backgroundColor));
      expect(fills[0]).not.toBe(fills[1]);
    });
  }

  test('a language this build cannot highlight renders as plain text, with no tokens and no crash', async ({ page, context }) => {
    await openMarkdownPage(page, context, 'light');

    const unknown = page.locator('article pre', { hasText: 'A language this build cannot highlight' });
    await expect(unknown).toBeVisible();
    await expect(unknown.locator('[class^="hl-"]')).toHaveCount(0);
    await expect(unknown).toContainText('A language this build cannot highlight renders as plain text.');
  });

  test('a wide code block scrolls inside its own container rather than widening the page', async ({ page, context }) => {
    await openMarkdownPage(page, context, 'light');
    await page.setViewportSize({ width: 320, height: 900 });

    await expectNoHorizontalOverflow(page, 'markdown page 320 light');
    await mdShot(page, 'read-320-light');
  });
});

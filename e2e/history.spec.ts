import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * Page history (revision-history spec: "Page History Query Returns
 * Revisions Newest First"; design.md "New UI screens" row 1). Against a
 * real, freshly seeded backend (e2e/global-setup.ts) — a page saved
 * twice, a page never saved, a reader who can see both, and an outsider
 * who can see neither.
 *
 * Sessions are minted directly in the seed rather than driven through the
 * sign-in UI, exactly as e2e/read.spec.ts does — this suite exercises the
 * history route, not authentication.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly historyPageId: string;
  readonly emptyHistoryPageId: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

// Serial for the same reason e2e/read.spec.ts is: these navigate to
// on-demand-compiled dev-server routes, and two simultaneous first
// compiles measured slower than one warm followed by another.
test.describe.configure({ mode: 'serial' });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

test('a reader sees every revision newest-first, with its author and changeset membership', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}/history`);

  // `<h1>Revision history</h1>` is server-rendered and visible immediately
  // regardless of client hydration; the list below it is not — it only
  // exists once the client mounts, fetches, and hydrates the skeleton away.
  // The generous timeout belongs on THAT wait, not on the heading: the dev
  // server compiles this route on first visit, which under load can take
  // longer than Playwright's 5s default (see e2e/read.spec.ts's identical
  // note).
  await expect(page.getByRole('heading', { level: 1, name: 'Revision history' })).toBeVisible();

  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30000 });

  // Newest first: the second save is the first row, and it has a
  // "Compare with previous" control because an earlier revision exists.
  await expect(rows.nth(0)).toContainText('E2E Owner');
  await expect(rows.nth(0).getByRole('button', { name: /compare with previous/i })).toBeVisible();

  // The oldest revision — the first save — has nothing before it
  // (revision-history spec): a real state, not an edge case.
  await expect(rows.nth(1)).toContainText('E2E Owner');
  await expect(rows.nth(1)).toContainText(/initial version/i);
  await expect(rows.nth(1).getByRole('button', { name: /compare with previous/i })).toHaveCount(0);
});

/**
 * The owner decision of 2026-09-08: revision timestamps read in the
 * *viewer's* timezone, not UTC. Two real browsers in two real zones is
 * the only place that can be proved end to end — a unit test can force
 * `process.env.TZ`, but only this one exercises the actual SSR/hydration
 * path the change is dangerous in.
 *
 * The expected string is recomputed here from the row's own `datetime`
 * attribute with the Intl options spelled out again, deliberately rather
 * than by importing the app's formatter: a test that calls the code under
 * test to build its own expectation asserts nothing. Written out, a
 * change to the app's option set fails this test instead of being
 * silently followed.
 */
const VIEWER_ZONES = ['America/New_York', 'Asia/Tokyo'] as const;

function expectedIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(new Date(iso));
}

test("a revision's timestamp reads in each viewer's own timezone, and hydrates without a mismatch", async ({ browser }) => {
  const rendered = new Map<string, { text: string; datetime: string }>();

  for (const timezoneId of VIEWER_ZONES) {
    const context = await browser.newContext({ timezoneId });
    await signInAs(context, fixtures.readerSessionToken);
    const page = await context.newPage();

    // Vue's dev build reports a hydration mismatch as a console warning
    // and nothing else — no thrown error, no failed assertion elsewhere —
    // so the only way to fail on one is to listen. The dev server is what
    // playwright.config.ts boots, so the dev build (and therefore this
    // warning) is present.
    const consoleMessages: string[] = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    page.on('pageerror', (error) => consoleMessages.push(error.message));

    await page.goto(`/pages/${fixtures.historyPageId}/history`);

    const timestamp = page.getByRole('listitem').nth(0).locator('time');
    await expect(timestamp).toBeVisible({ timeout: 30000 });

    const datetime = await timestamp.getAttribute('datetime');
    expect(datetime, 'the machine-readable instant must survive whatever the human sees').not.toBeNull();
    const text = (await timestamp.innerText()).trim();

    expect(text).toBe(expectedIn(datetime!, timezoneId));
    // The label is the whole reason a bare local time is not ambiguous.
    expect(text).not.toMatch(/\bUTC$/);

    // Proof the console listener above is actually attached and receiving
    // — without this, "no hydration warning" would also be what a broken
    // listener reports, and this repository has shipped a check that
    // silently stopped checking before.
    await page.evaluate(() => console.debug('e2e:console-probe'));
    await expect.poll(() => consoleMessages).toContain('e2e:console-probe');
    expect(consoleMessages.filter((line) => /hydrat/i.test(line))).toEqual([]);

    rendered.set(timezoneId, { text, datetime: datetime! });
    await context.close();
  }

  const newYork = rendered.get('America/New_York')!;
  const tokyo = rendered.get('Asia/Tokyo')!;

  // Same instant, two readings. If these two ever match, the screen is
  // rendering one fixed zone again whatever the label happens to say.
  expect(newYork.datetime).toBe(tokyo.datetime);
  expect(newYork.text).not.toBe(tokyo.text);
});

test('the inert compare control explains itself and does nothing when activated', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}/history`);

  const compare = page.getByRole('listitem').nth(0).getByRole('button', { name: /compare with previous/i });
  await expect(compare).toBeVisible({ timeout: 30000 });
  // aria-disabled, not the disabled attribute: it stays reachable by
  // keyboard so its explanation is available on focus, not only on hover
  // (docs/UI-CHECKLIST.md §5).
  await expect(compare).toHaveAttribute('aria-disabled', 'true');
  await compare.focus();
  await expect(compare).toBeFocused();

  const urlBefore = page.url();
  await compare.click({ force: true });
  await expect(page).toHaveURL(urlBefore);
});

test('a page that has never been saved shows the empty state with a path forward', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/pages/${fixtures.emptyHistoryPageId}/history`);

  await expect(page.getByRole('heading', { name: /no revisions yet/i })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /start editing/i })).toBeVisible();
});

test('an outsider with no read grant sees the same not-found state a nonexistent page would render', async ({ page, context }) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto(`/pages/${fixtures.historyPageId}/history`);
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });
  // Non-disclosure: neither the page's own title nor any revision content
  // leaks into a response the viewer is not entitled to.
  const deniedHtml = await page.content();
  expect(deniedHtml).not.toContain('E2E History Page');
  expect(deniedHtml).not.toContain('E2E Owner');
  await expect(page.getByRole('listitem')).toHaveCount(0);

  await page.goto(`/pages/${crypto.randomUUID()}/history`);
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible({ timeout: 30000 });
});

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { API_URL } from './ports';

/**
 * Editing presence (editing-presence spec; design.md Decision 5; tasks.md
 * 10.11's "e2e coverage per §7 including the soft-lock-path scenario").
 * Like e2e/editor.spec.ts, this suite mocks the API at the network
 * boundary rather than seeding a real backend — the scenario under test is
 * the CLIENT's rendering of presence over the SSE wire protocol, which
 * `apps/api/src/routes/presence.test.ts` already proves server-side
 * (per-subscriber filtering, non-disclosure). Two real browser contexts —
 * not one page with two logical "users" — because presence is inherently
 * about what one connection knows that another does not.
 *
 * Two scenarios: the one cross-tab edit case (a displaced editor's
 * presence subscription is what makes a takeover *informed* rather than
 * silent — docs/UI-CHECKLIST.md §4.8), and the read screen. Until
 * 2026-09-14 the read screen could not open the stream at all — the stream
 * is workspace-scoped and `GET /pages/:id` carried no `workspaceId`; the
 * only route that did acquires the soft lock as a side effect. The read
 * response now names the workspace, so "a reader sees who is editing"
 * runs against real client code below.
 */

test.describe.configure({ mode: 'serial' });

interface SeedFixtures {
  readonly readPageId: string;
  readonly historyPageId: string;
  readonly bookHistoryPageAId: string;
  readonly bookHistoryPageBId: string;
  readonly workspaceId: string;
  readonly readerSessionToken: string;
}

/** The real backend's seed, for the two tests below that count requests against `apps/api` itself rather than a mocked stream. */
const seed: SeedFixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

const PAGE_ID = '44444444-4444-4444-4444-444444444444';
const WORKSPACE_ID = 'ws-presence-e2e';

function apiOrigin(): string {
  return API_URL;
}

async function signIn(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
}

/** One SSE frame, in the exact wire shape `presence.ts`'s `stream.writeSSE` produces. */
function presenceFrame(payload: {
  pageId: string;
  userId: string;
  userDisplayName: string;
  since: string;
}): string {
  return `event: presence\ndata: ${JSON.stringify({ mode: 'editing', pageTitle: 'Presence E2E Page', ...payload })}\n\n`;
}

/**
 * A presence stream whose content can change between reconnects: real
 * `EventSource` reconnects on its own once a response ends (the `retry:`
 * field below shortens that to 250ms so the test does not wait out the
 * real 3s default), and each reconnect re-invokes this route handler —
 * which is exactly the mechanism `usePresenceStream`'s own reconnect logic
 * is built to tolerate. `holder` is a mutable closure the test flips to
 * simulate another tab's takeover becoming visible on this connection.
 */
function mockPresenceStream(page: Page, holder: { current: { userId: string; userDisplayName: string; since: string } | null }): Promise<void> {
  return page.route(`${apiOrigin()}/workspaces/${WORKSPACE_ID}/presence/stream`, async (route) => {
    const body = `retry: 250\n: connected\n\n${holder.current ? presenceFrame({ pageId: PAGE_ID, ...holder.current }) : ''}`;
    const origin = (await route.request().headerValue('origin')) ?? '*';
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      // `EventSource(url, { withCredentials: true })` is a credentialed
      // cross-origin request (web and API dev servers are different
      // origins/ports): the wildcard `*` is rejected outright once
      // credentials are involved, unlike a plain unauthenticated fetch —
      // the actual origin must be reflected, plus the explicit
      // allow-credentials header.
      headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' },
      body,
    });
  });
}

test('a displaced editor is shown, by name and since when, who now holds the page — presence makes the takeover informed, not silent', async ({ browser }) => {
  test.setTimeout(60000);

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await signIn(pageA, 'e2e-presence-a-token');

  const bHolder: { current: { userId: string; userDisplayName: string; since: string } | null } = { current: null };
  await mockPresenceStream(pageA, bHolder);
  await pageA.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        markdown: 'Held by A.\n',
        title: 'Presence E2E Page',
        workspaceId: WORKSPACE_ID,
        lock: { holderUserId: 'user-a', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
      }),
    }),
  );
  // A's own heartbeat is deliberately kept `ok` throughout — this test is
  // isolated to what presence surfaces, not the separate "Lock lost"
  // banner (also `role="status"`), which a real takeover would eventually
  // trigger on A's next heartbeat but is not this test's concern.
  await pageA.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );

  await pageA.goto(`/pages/${PAGE_ID}/edit`);
  await expect(pageA.getByTestId('editor-surface')).toBeVisible({ timeout: 30000 });

  // Nobody else is editing yet: no presence indicator at all.
  await expect(pageA.getByTestId('presence-indicator')).toHaveCount(0);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signIn(pageB, 'e2e-presence-b-token');
  await pageB.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        reason: 'locked',
        holder: { userId: 'user-a', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
        offeredExits: ['read_only', 'take_over'],
      }),
    }),
  );
  const takeOverSince = new Date().toISOString();
  await pageB.route(`${apiOrigin()}/pages/${PAGE_ID}/lock/take-over`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        markdown: 'Held by A.\n',
        title: 'Presence E2E Page',
        workspaceId: WORKSPACE_ID,
        lock: { holderUserId: 'user-b', acquiredAt: takeOverSince, heartbeatAt: takeOverSince },
      }),
    }),
  );
  await pageB.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );

  await pageB.goto(`/pages/${PAGE_ID}/edit`);
  await expect(pageB.getByRole('button', { name: 'Take over editing' })).toBeVisible({ timeout: 30000 });
  await pageB.getByRole('button', { name: 'Take over editing' }).click();
  await pageB.getByRole('button', { name: 'Take over', exact: true }).click();
  await expect(pageB.getByTestId('editor-surface')).toBeVisible({ timeout: 30000 });

  // B has taken over. The next time A's connection reconnects (≤250ms,
  // the `retry:` hint above), it must learn this — appearing, named, with
  // a duration, never as a second silent lock.
  bHolder.current = { userId: 'user-b', userDisplayName: 'User B', since: takeOverSince };
  await expect(pageA.getByTestId('presence-indicator')).toContainText('User B is editing since', { timeout: 10000 });
  // §4.11: the zone is named in the string, and the exact instant is
  // preserved in `<time datetime>` regardless of how it is displayed.
  await expect(pageA.getByTestId('presence-indicator').locator('time')).toHaveAttribute('datetime', takeOverSince);

  // §4.8: never a hard lock — A's own editing surface and its Save
  // affordance stay present and operable; another editor's presence is
  // informational, never a barrier. (Save itself is disabled here only
  // because A has made no edits in this test — the same as it would be
  // with no presence at all — so the editor's own editability, not the
  // button's dirty-tracking state, is what this asserts.)
  await expect(pageA.getByTestId('editor-surface')).toBeVisible();
  await pageA.getByTestId('editor-surface').click();
  await pageA.keyboard.type(' more');
  await expect(pageA.getByRole('button', { name: /Save/ })).toBeEnabled();

  await contextA.close();
  await contextB.close();
});

test('stale presence expires visibly once its heartbeat window lapses, tied to the same TTL the lock itself uses', async ({ browser }) => {
  test.setTimeout(60000);

  const context = await browser.newContext();
  const page = await context.newPage();
  // Installed before navigation: every timer this page creates for its
  // whole lifetime — including `usePresenceStream`'s own expiry-pruning
  // interval — runs on this virtual clock, so the 120s TTL window can be
  // skipped instantly instead of the test actually waiting two minutes.
  // Real network I/O (the mocked route above, and native `EventSource`'s
  // own reconnect scheduling) is untouched by this — only JS-level
  // timers are virtual.
  await page.clock.install();
  await signIn(page, 'e2e-presence-expiry-token');

  const holder: { current: { userId: string; userDisplayName: string; since: string } | null } = {
    current: { userId: 'user-b', userDisplayName: 'User B', since: new Date().toISOString() },
  };
  await mockPresenceStream(page, holder);
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/edit-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        markdown: 'Held by A.\n',
        title: 'Presence E2E Page',
        workspaceId: WORKSPACE_ID,
        lock: { holderUserId: 'user-a', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() },
      }),
    }),
  );
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}/lock`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }),
  );

  await page.goto(`/pages/${PAGE_ID}/edit`);
  await expect(page.getByTestId('editor-surface')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('presence-indicator')).toContainText('User B is editing', { timeout: 10000 });

  // No renewing heartbeat arrives from here on (the mock keeps answering
  // with the same, un-refreshed `since`, which the composable only ever
  // treats as a renewal via a fresh *reception*, not a fresh `since`
  // value — stop delivering it entirely, the way a closed laptop would).
  holder.current = null;
  await page.clock.fastForward('02:10');

  await expect(page.getByTestId('presence-indicator')).toHaveCount(0);
  await context.close();
});

test('a reader sees who is editing the page, and since when, without acquiring any lock', async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page, 'e2e-presence-reader-token');

  const since = new Date().toISOString();
  await mockPresenceStream(page, { current: { userId: 'user-b', userDisplayName: 'User B', since } });
  const lockRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/edit-session|\/lock/.test(request.url())) lockRequests.push(request.url());
  });
  await page.route(`${apiOrigin()}/pages/${PAGE_ID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ html: '<p>Read by many.</p>', title: 'Presence E2E Page', workspaceId: WORKSPACE_ID }),
    });
  });

  await page.goto(`/pages/${PAGE_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Presence E2E Page' })).toBeVisible({ timeout: 30000 });

  // §4.8: who, and since when — named, with the exact instant preserved.
  await expect(page.getByTestId('presence-indicator')).toContainText('User B is editing since', { timeout: 10000 });
  await expect(page.getByTestId('presence-indicator').locator('time')).toHaveAttribute('datetime', since);
  // The read screen learned the workspace from the read response alone:
  // no edit-session probe, no lock, no heartbeat.
  expect(lockRequests).toEqual([]);
});


/**
 * The transport itself, against the real `apps/api` on `Bun.serve`. Until
 * 2026-09-16 the server closed every presence stream after ten idle
 * seconds (`Bun.serve`'s default `idleTimeout`; the browser reported
 * `ERR_INCOMPLETE_CHUNKED_ENCODING`) and `EventSource` reconnected — a new
 * request every ~10 s for as long as a screen stayed open. The route now
 * writes a keep-alive comment inside that window
 * (`apps/api/src/routes/presence.ts`, `SSE_KEEP_ALIVE_SECONDS`), so a stream
 * held open for 25 s is one request. A request count, on purpose: the
 * observable of a dropped stream is the reconnect, and nothing a person
 * sees changes between one connection and a chain of them — this is a
 * transport contract, not a screen contract (docs/UI-CHECKLIST.md §7).
 */
test('a presence stream held open for 25 seconds is one request — the server keeps it alive inside its idle timeout', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, seed.readerSessionToken);
  const streamRequests: number[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`/workspaces/${seed.workspaceId}/presence/stream`)) streamRequests.push(Date.now());
  });

  await page.goto(`/pages/${seed.readPageId}`);
  // The stream opens once the read response has named the workspace;
  // under load, hydration alone can take tens of seconds.
  await expect.poll(() => streamRequests.length, { timeout: 120_000, message: 'the presence stream never opened' }).toBe(1);

  // Two and a half idle timeouts: a stream the server still dropped
  // would have reconnected at least twice in this window.
  await page.waitForTimeout(25_000);

  expect(streamRequests, `stream requests at ${streamRequests.map((at) => at - streamRequests[0]!).join(', ')} ms`).toHaveLength(1);
});

/**
 * The stream is the workspace's, not the screen's (`usePresenceStream.ts`,
 * 2026-09-16): a hop from one page to the next hands the one connection
 * from the leaving screen to the arriving one instead of closing it and
 * opening another. Two pages in the same book, reached by the tree — the
 * way a person hops — and one stream request for both.
 */
test('two consecutive page hops open one presence stream', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, seed.readerSessionToken);
  const streamRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`/workspaces/${seed.workspaceId}/presence/stream`)) streamRequests.push(request.url());
  });

  await page.goto(`/pages/${seed.bookHistoryPageAId}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'E2E Book Page Alpha' })).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => streamRequests.length, { timeout: 60_000, message: 'the presence stream never opened' }).toBe(1);

  // The hop: a tree row, so the frame stays and only the pane changes.
  const sidebar = page.getByRole('navigation', { name: 'Workspace' });
  const beta = sidebar.getByRole('treeitem', { name: /E2E Book Page Beta/ });
  await expect(beta).toBeVisible({ timeout: 60_000 });
  await beta.locator('[draggable="true"]').first().click();
  await expect(page).toHaveURL(new RegExp(`/pages/${seed.bookHistoryPageBId}$`));
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'E2E Book Page Beta' })).toBeVisible({ timeout: 60_000 });

  // Long enough for a second screen that reopened the stream to have done so.
  await page.waitForTimeout(3_000);
  expect(streamRequests).toHaveLength(1);
});

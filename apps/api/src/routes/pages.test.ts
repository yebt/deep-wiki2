/**
 * Page content routes behind can(), optimistic concurrency, and the
 * fail-closed edit-session probe (page-content spec; content-and-editor
 * design.md "The save transaction", "Fail-closed: the per-document probe").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession, savePage } from '@deep-wiki/db';
import { provisionTestDatabase, TEST_CHANGESET_WINDOW_MINUTES, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import type { PresenceBroadcaster, PresenceEvent } from '@deep-wiki/core';
import postgres from 'postgres';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createPageRoutes } from './pages';

class RecordingBroadcaster implements PresenceBroadcaster {
  readonly published: PresenceEvent[] = [];
  publish(event: PresenceEvent): void {
    this.published.push(event);
  }
  subscribe(): () => void {
    return () => {};
  }
}

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

interface Fixture {
  readonly workspaceId: string;
  readonly pageId: string;
  readonly readerCookie: string;
  readonly writerCookie: string;
  readonly outsiderCookie: string;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function buildFixture(): Promise<Fixture> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [reader] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`reader-${crypto.randomUUID()}@example.com`}, 'hash', 'Reader') RETURNING id
  `;
  const [writer] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`writer-${crypto.randomUUID()}@example.com`}, 'hash', 'Writer') RETURNING id
  `;
  const [outsider] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`outsider-${crypto.randomUUID()}@example.com`}, 'hash', 'Outsider') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
  `;
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${reader!.id}, ${page!.id}, 'read', 'allow')
  `;
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${writer!.id}, ${page!.id}, 'write', 'allow')
  `;

  return {
    workspaceId: ws!.id,
    pageId: page!.id,
    readerCookie: await cookieFor(reader!.id),
    writerCookie: await cookieFor(writer!.id),
    outsiderCookie: await cookieFor(outsider!.id),
  };
}


/** The slug the fixture's workspace was minted with — what every node response must name beside the id (2026-09-17). */
async function workspaceSlugOf(workspaceId: string): Promise<string> {
  const [row] = await sql<{ slug: string }[]>`SELECT slug FROM workspaces WHERE id = ${workspaceId}`;
  return row!.slug;
}

function buildApp() {
  return createPageRoutes({ sql, sessionIdleTimeoutMinutes: 30, pageLockTtlSeconds: 120, changesetWindowMinutes: 30 });
}

// page-content: Content Access Goes Through can(), both scenarios.
describe('GET /pages/:id', () => {
  test('a subject with no read grant receives no content', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, { headers: { cookie: fixture.outsiderCookie } });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { html?: string };
    expect(body.html).toBeUndefined();
  });

  test('a subject with a read grant receives the cached HTML', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { html: string; title: string };
    expect(body.html).toContain('Hello');
    expect(body.title).toBe('A Page');
  });

  // The read screen opens the workspace-scoped presence stream and has no
  // side-effect-free way to learn the workspace id otherwise: the only other
  // route carrying it is `GET /pages/:id/edit-session`, which acquires the
  // edit lock. The value is already on the row this handler reads.
  test('the read response names the workspace the page belongs to', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspaceId?: string };
    expect(body.workspaceId).toBe(fixture.workspaceId);
  });

  // The frame holds `/w/<slug>/p/<id>` to its word from this response
  // rather than a second request (`GET /nodes/:id/location`), which was
  // one more per node screen and put the edit route at 501 of its 500.
  test('the read response names the workspace by id and slug together', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspace?: { id: string; slug: string } };
    expect(body.workspace).toEqual({ id: fixture.workspaceId, slug: await workspaceSlugOf(fixture.workspaceId) });
  });
});

describe('PUT /pages/:id', () => {
  test('a subject with no write grant cannot save, and storage is unchanged', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Original\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ markdown: '# Changed\n', expectedContentHash: null }),
    });

    expect(res.status).toBe(403);
    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    expect(row!.markdown).toBe('# Original\n');
  });

  test('a stale content_hash returns 409 without writing', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Original\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ markdown: '# Changed\n', expectedContentHash: 'wrong-hash' }),
    });

    expect(res.status).toBe(409);
    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    expect(row!.markdown).toBe('# Original\n');
  });

  test('an authorised save with a matching content_hash persists the new markdown', async () => {
    const fixture = await buildFixture();
    const first = await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Original\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ markdown: '# Changed\n', expectedContentHash: first.contentHash }),
    });

    expect(res.status).toBe(200);
    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    expect(row!.markdown).toBe('# Changed\n');
    expect(((await res.json()) as { unchanged: boolean }).unchanged).toBe(false);
  });

  // revision-history spec: a revision pairs with "the corresponding
  // `page_content` change"; a byte-identical save has none. The route
  // answers 200 with the same hash and says so, and the history gains no
  // row whose diff would be empty (docs/TODO.md Findings, 2026-09-17).
  test('a byte-identical save answers 200 with `unchanged: true` and writes no revision', async () => {
    const fixture = await buildFixture();
    const first = await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Original\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ markdown: '# Original\n', expectedContentHash: first.contentHash }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentHash: string; unchanged: boolean };
    expect(body.contentHash).toBe(first.contentHash);
    expect(body.unchanged).toBe(true);
    const revisions = await sql`SELECT 1 AS x FROM page_revision WHERE page_id = ${fixture.pageId}`;
    expect(revisions).toHaveLength(1);
  });

  // page-content spec, mirroring `DeadAnchorError`'s own fixtures in
  // `packages/db/src/content/rebuild-derived.test.ts`: the conflict this
  // guard turns on is `(page_id, block_id)`, so the anchor has to be
  // reintroduced on the SAME page to exercise anything.
  test('a save that reintroduces a tombstoned anchor answers 409 with the corrected document, not 500', async () => {
    const fixture = await buildFixture();
    const WITH_ANCHOR = 'Apples and oranges are tasty fruits, and bananas are also delicious. ^abc1234567\n';
    const FILLER = 'Zebras migrate north through dusty savannah every summer without exception.\n';

    const first = await savePage(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      markdown: `${WITH_ANCHOR}\n${FILLER}`,
      expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });
    // Delete the anchored paragraph: matchBlocks scores it against nothing
    // it recognises, so the id is tombstoned.
    const second = await savePage(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      markdown: FILLER,
      expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });
    const app = buildApp();

    // The author pastes the paragraph back, literal ` ^abc1234567` and all.
    const reintroduced = `${FILLER}\n${WITH_ANCHOR}`;
    const res = await app.request(`/pages/${fixture.pageId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ markdown: reintroduced, expectedContentHash: second.contentHash }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string; corrected?: string; anchors?: { id: string; status: string }[] };
    expect(body.corrected).toBe(reintroduced.replace(' ^abc1234567', ''));
    expect(body.anchors).toEqual([{ id: 'abc1234567', status: 'tombstoned' }]);

    // `reconcileDerived` runs inside `savePage`'s transaction, so the
    // refusal has to roll the content write back with it.
    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    expect(row!.markdown).toBe(FILLER);
  });

  // versioning-and-collaboration design.md Decision 4: changesetWindowMinutes
  // is threaded from route deps through to savePage(), mirroring
  // pageLockTtlSeconds's propagation path exactly.
  test('a save on a page under a book joins a changeset using the configured window', async () => {
    const [owner] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
    `;
    const [writer] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`writer-${crypto.randomUUID()}@example.com`}, 'hash', 'Writer') RETURNING id
    `;
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
    `;
    const [root] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
    `;
    const [shelf] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${root!.id}, 'shelf', '', 0, 'shelf', 'Shelf') RETURNING id
    `;
    const [book] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${shelf!.id}, 'book', '', 0, 'book', 'Book') RETURNING id
    `;
    const [page] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${book!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${writer!.id}, ${page!.id}, 'write', 'allow')
    `;
    const writerCookie = await cookieFor(writer!.id);

    const app = createPageRoutes({ sql, sessionIdleTimeoutMinutes: 30, pageLockTtlSeconds: 120, changesetWindowMinutes: 30 });

    const res = await app.request(`/pages/${page!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: writerCookie },
      body: JSON.stringify({ markdown: '# Hello\n', expectedContentHash: null }),
    });

    expect(res.status).toBe(200);
    const [revision] = await sql<{ changeset_id: string | null }[]>`
      SELECT changeset_id FROM page_revision WHERE page_id = ${page!.id}
    `;
    expect(revision!.changeset_id).not.toBeNull();
    const [changeset] = await sql<{ book_id: string; author_id: string }[]>`
      SELECT book_id, author_id FROM changeset WHERE id = ${revision!.changeset_id}
    `;
    expect(changeset!.book_id).toBe(book!.id);
    expect(changeset!.author_id).toBe(writer!.id);
  });
});

// markdown-round-trip: Refusal states a reason; Read-only remains available.
describe('GET /pages/:id/edit-session', () => {
  test('returns the canonical markdown and acquires the lock when the round trip holds', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string; workspaceId: string; workspace: { id: string; slug: string }; lock: { holderUserId: string } };
    expect(body.markdown).toBe('# Hello\n');
    expect(body.workspaceId).toBe(fixture.workspaceId);
    expect(body.workspace).toEqual({ id: fixture.workspaceId, slug: await workspaceSlugOf(fixture.workspaceId) });
    expect(body.lock.holderUserId).toBeDefined();

    const [lockRow] = await sql`SELECT holder_user_id FROM page_locks WHERE node_id = ${fixture.pageId}`;
    expect(lockRow).toBeTruthy();
  });

  // page-content spec, D16: the browser's first Save on an already-saved
  // page has no other way to learn the row's current content_hash — the
  // read screen never acquires the lock, and this is the only route that
  // does. Without it, edit.vue sends `expectedContentHash: null`, which
  // `savePage()` treats as a brand-new page and refuses with a
  // stale-content 409 on every page that already has content (docs/TODO.md
  // Finding, this task; reproduced by e2e/comments.spec.ts's PUT
  // workaround before this fix).
  test('the response carries the row’s real content_hash, so a real Save can match it', async () => {
    const fixture = await buildFixture();
    const saved = await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentHash?: string };
    expect(body.contentHash).toBe(saved.contentHash);
  });

  test('a refused document returns 409 naming the reason and offers read-only/normalise, without acquiring a lock', async () => {
    const fixture = await buildFixture();
    // A setext heading is refused (bucket C) — inserted directly, bypassing
    // savePage's own canonical assertion, to exercise the probe path.
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Title\n=====\n', 'hash-refused')
    `;
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason?: string; line?: number; offeredExits: string[]; workspace?: { id: string; slug: string } };
    expect(body.reason).toBe('not_byte_identical');
    // edit.vue points the author at this line; a refusal without it cannot explain itself.
    expect(body.line).toBe(1);
    expect(body.offeredExits).toEqual(expect.arrayContaining(['read_only', 'normalise']));
    // A refused session is still about a page on an address the frame holds to its word.
    expect(body.workspace).toEqual({ id: fixture.workspaceId, slug: await workspaceSlugOf(fixture.workspaceId) });

    const [lockRow] = await sql`SELECT 1 AS x FROM page_locks WHERE node_id = ${fixture.pageId}`;
    expect(lockRow).toBeUndefined();
  });

  test('an empty page opens an edit session rather than being refused forever', async () => {
    // `markdown: z.string()` has no minimum and `canonicalise('') === ''`, so
    // a writer who clears a page and saves stores exactly this row. Until
    // the probe accepted an empty document, this request answered 409 with
    // no construct and no line — the page could never be edited again.
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string };
    expect(body.markdown).toBe('');
  });

  test('a page already locked by another writer reports the holder and offers read-only/take-over', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();
    await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    const [secondWriter] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`writer2-${crypto.randomUUID()}@example.com`}, 'hash', 'Writer2') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${fixture.workspaceId}, 'user', ${secondWriter!.id}, ${fixture.pageId}, 'write', 'allow')
    `;
    const secondCookie = await cookieFor(secondWriter!.id);

    const res = await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: secondCookie } });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string; offeredExits: string[]; workspace?: { id: string; slug: string } };
    expect(body.reason).toBe('locked');
    expect(body.offeredExits).toEqual(expect.arrayContaining(['read_only', 'take_over']));
    expect(body.workspace).toEqual({ id: fixture.workspaceId, slug: await workspaceSlugOf(fixture.workspaceId) });
  });
});

// document-modes: Heartbeat Keeps The Lock Alive; "Take Over" Transfers The Lock.
describe('PATCH /pages/:id/lock', () => {
  test('a heartbeat from the current holder extends the lock and returns ok', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();
    await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    const res = await app.request(`/pages/${fixture.pageId}/lock`, { method: 'PATCH', headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  // editing-presence spec: "A Lock Heartbeat Always Refreshes Presence" —
  // this route's heartbeat is the sole write path presence has.
  test('a successful heartbeat publishes a presence event through the wired broadcaster', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const broadcaster = new RecordingBroadcaster();
    const app = createPageRoutes({ sql, sessionIdleTimeoutMinutes: 30, pageLockTtlSeconds: 120, changesetWindowMinutes: 30, broadcaster });
    await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    const res = await app.request(`/pages/${fixture.pageId}/lock`, { method: 'PATCH', headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    expect(broadcaster.published).toHaveLength(1);
    expect(broadcaster.published[0]?.pageId).toBe(fixture.pageId);
    expect(broadcaster.published[0]?.workspaceId).toBe(fixture.workspaceId);
  });

  test('a heartbeat from a displaced holder reports lost', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();
    await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    const [secondWriter] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`writer3-${crypto.randomUUID()}@example.com`}, 'hash', 'Writer3') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${fixture.workspaceId}, 'user', ${secondWriter!.id}, ${fixture.pageId}, 'write', 'allow')
    `;
    const secondCookie = await cookieFor(secondWriter!.id);
    await app.request(`/pages/${fixture.pageId}/lock/take-over`, { method: 'POST', headers: { cookie: secondCookie } });

    const res = await app.request(`/pages/${fixture.pageId}/lock`, { method: 'PATCH', headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('lost');
  });

  test('a subject with no write grant cannot heartbeat', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/lock`, { method: 'PATCH', headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(403);
  });
});

describe('POST /pages/:id/lock/take-over', () => {
  test('transfers the lock to the caller and returns the markdown', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();
    await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    const [secondWriter] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`writer4-${crypto.randomUUID()}@example.com`}, 'hash', 'Writer4') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${fixture.workspaceId}, 'user', ${secondWriter!.id}, ${fixture.pageId}, 'write', 'allow')
    `;
    const secondCookie = await cookieFor(secondWriter!.id);

    const res = await app.request(`/pages/${fixture.pageId}/lock/take-over`, { method: 'POST', headers: { cookie: secondCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string; workspace: { id: string; slug: string }; lock: { holderUserId: string } };
    expect(body.markdown).toBe('# Hello\n');
    expect(body.workspace).toEqual({ id: fixture.workspaceId, slug: await workspaceSlugOf(fixture.workspaceId) });
    expect(body.lock.holderUserId).toBe(secondWriter!.id);

    const [lockRow] = await sql`SELECT holder_user_id FROM page_locks WHERE node_id = ${fixture.pageId}`;
    expect(lockRow!.holder_user_id).toBe(secondWriter!.id);
  });

  // page-content spec, D16: the taking-over author's first Save needs the
  // same hash for the same reason the initial edit-session response does.
  test('the response also carries the row’s real content_hash', async () => {
    const fixture = await buildFixture();
    const saved = await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();
    await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    const [secondWriter] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`writer5-${crypto.randomUUID()}@example.com`}, 'hash', 'Writer5') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${fixture.workspaceId}, 'user', ${secondWriter!.id}, ${fixture.pageId}, 'write', 'allow')
    `;
    const secondCookie = await cookieFor(secondWriter!.id);

    const res = await app.request(`/pages/${fixture.pageId}/lock/take-over`, { method: 'POST', headers: { cookie: secondCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentHash?: string };
    expect(body.contentHash).toBe(saved.contentHash);
  });

  test('a subject with no write grant cannot take over the lock', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/lock/take-over`, { method: 'POST', headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(403);
  });
});

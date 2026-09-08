/**
 * Page content routes behind can(), optimistic concurrency, and the
 * fail-closed edit-session probe (page-content spec; content-and-editor
 * design.md "The save transaction", "Fail-closed: the per-document probe").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession, savePage } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createPageRoutes } from './pages';

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

function buildApp() {
  return createPageRoutes({ sql, sessionIdleTimeoutMinutes: 30, pageLockTtlSeconds: 120, changesetWindowMinutes: 30 });
}

// page-content: Content Access Goes Through can(), both scenarios.
describe('GET /pages/:id', () => {
  test('a subject with no read grant receives no content', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, { headers: { cookie: fixture.outsiderCookie } });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { html?: string };
    expect(body.html).toBeUndefined();
  });

  test('a subject with a read grant receives the cached HTML', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { html: string; title: string };
    expect(body.html).toContain('Hello');
    expect(body.title).toBe('A Page');
  });
});

describe('PUT /pages/:id', () => {
  test('a subject with no write grant cannot save, and storage is unchanged', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Original\n', expectedContentHash: null });
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
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Original\n', expectedContentHash: null });
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
    const first = await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Original\n', expectedContentHash: null });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ markdown: '# Changed\n', expectedContentHash: first.contentHash }),
    });

    expect(res.status).toBe(200);
    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    expect(row!.markdown).toBe('# Changed\n');
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
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string; workspaceId: string; lock: { holderUserId: string } };
    expect(body.markdown).toBe('# Hello\n');
    expect(body.workspaceId).toBe(fixture.workspaceId);
    expect(body.lock.holderUserId).toBeDefined();

    const [lockRow] = await sql`SELECT holder_user_id FROM page_locks WHERE node_id = ${fixture.pageId}`;
    expect(lockRow).toBeTruthy();
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
    const body = (await res.json()) as { reason?: string; offeredExits: string[] };
    expect(body.reason).toBeDefined();
    expect(body.offeredExits).toEqual(expect.arrayContaining(['read_only', 'normalise']));

    const [lockRow] = await sql`SELECT 1 AS x FROM page_locks WHERE node_id = ${fixture.pageId}`;
    expect(lockRow).toBeUndefined();
  });

  test('a page already locked by another writer reports the holder and offers read-only/take-over', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
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
    const body = (await res.json()) as { reason: string; offeredExits: string[] };
    expect(body.reason).toBe('locked');
    expect(body.offeredExits).toEqual(expect.arrayContaining(['read_only', 'take_over']));
  });
});

// document-modes: Heartbeat Keeps The Lock Alive; "Take Over" Transfers The Lock.
describe('PATCH /pages/:id/lock', () => {
  test('a heartbeat from the current holder extends the lock and returns ok', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
    const app = buildApp();
    await app.request(`/pages/${fixture.pageId}/edit-session`, { headers: { cookie: fixture.writerCookie } });

    const res = await app.request(`/pages/${fixture.pageId}/lock`, { method: 'PATCH', headers: { cookie: fixture.writerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  test('a heartbeat from a displaced holder reports lost', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
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
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/lock`, { method: 'PATCH', headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(403);
  });
});

describe('POST /pages/:id/lock/take-over', () => {
  test('transfers the lock to the caller and returns the markdown', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
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
    const body = (await res.json()) as { markdown: string; lock: { holderUserId: string } };
    expect(body.markdown).toBe('# Hello\n');
    expect(body.lock.holderUserId).toBe(secondWriter!.id);

    const [lockRow] = await sql`SELECT holder_user_id FROM page_locks WHERE node_id = ${fixture.pageId}`;
    expect(lockRow!.holder_user_id).toBe(secondWriter!.id);
  });

  test('a subject with no write grant cannot take over the lock', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# Hello\n', expectedContentHash: null });
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/lock/take-over`, { method: 'POST', headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(403);
  });
});

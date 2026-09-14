/**
 * `GET /pages/:id/diff?from=&to=` and `GET /books/:id/diff?since=`
 * (block-diff spec). Both re-parse revision content fresh via
 * `diffBlocks()` — never a stored `block_index` — and both go through
 * `can('read')`; absence and denial share one response.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession, savePage } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import type { BlockChange } from '@deep-wiki/core';
import postgres from 'postgres';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createDiffRoutes } from './diff';

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

const WINDOW_MINUTES = 30;

async function seedUser(displayName: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${displayName.toLowerCase()}-${crypto.randomUUID()}@example.com`}, 'hash', ${displayName})
    RETURNING id
  `;
  return user!.id;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function buildApp() {
  return createDiffRoutes({ sql, sessionIdleTimeoutMinutes: 30 });
}

describe('GET /pages/:id/diff', () => {
  async function buildPageFixture() {
    const owner = await seedUser('Owner');
    const reader = await seedUser('Reader');
    const outsider = await seedUser('Outsider');
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
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
      VALUES (${ws!.id}, 'user', ${reader}, ${page!.id}, 'read', 'allow')
    `;

    const first = await savePage(sql, { nodeId: page!.id, workspaceId: ws!.id, markdown: 'One paragraph.\n', expectedContentHash: null, updatedBy: owner, changesetWindowMinutes: WINDOW_MINUTES });
    const second = await savePage(sql, {
      nodeId: page!.id,
      workspaceId: ws!.id,
      markdown: 'One paragraph.\n\nA brand new paragraph.\n',
      expectedContentHash: first.contentHash,
      updatedBy: owner, changesetWindowMinutes: WINDOW_MINUTES,
    });
    void second;

    const historyRows = await sql<{ id: string }[]>`
      SELECT id FROM page_revision WHERE page_id = ${page!.id} ORDER BY created_at ASC
    `;

    return {
      workspaceId: ws!.id,
      pageId: page!.id,
      readerCookie: await cookieFor(reader),
      outsiderCookie: await cookieFor(outsider),
      fromRevisionId: historyRows[0]!.id,
      toRevisionId: historyRows[1]!.id,
    };
  }

  test('reports an added block between two revisions for a subject with read', async () => {
    const fixture = await buildPageFixture();
    const app = buildApp();

    const res = await app.request(
      `/pages/${fixture.pageId}/diff?from=${fixture.fromRevisionId}&to=${fixture.toRevisionId}`,
      { headers: { cookie: fixture.readerCookie } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: { changes: BlockChange[] } };
    expect(body.diff.changes.some((change) => change.kind === 'added')).toBe(true);
  });

  test('the added block carries its own text, and the response names which two revisions were compared', async () => {
    const fixture = await buildPageFixture();
    const app = buildApp();

    const res = await app.request(
      `/pages/${fixture.pageId}/diff?from=${fixture.fromRevisionId}&to=${fixture.toRevisionId}`,
      { headers: { cookie: fixture.readerCookie } },
    );

    const body = (await res.json()) as {
      diff: { from: { id: string }; to: { id: string }; changes: (BlockChange & { text: string })[] };
    };
    expect(body.diff.from.id).toBe(fixture.fromRevisionId);
    expect(body.diff.to.id).toBe(fixture.toRevisionId);
    const added = body.diff.changes.find((change) => change.kind === 'added');
    expect(added?.text).toContain('brand new paragraph');
  });

  test('a genuinely moved block is reported moved with its own byte-identical text, distinct from the unrelated block that stayed put', async () => {
    const owner = await seedUser('Owner');
    const reader = await seedUser('Reader');
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
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
      VALUES (${ws!.id}, 'user', ${reader}, ${page!.id}, 'read', 'allow')
    `;
    const first = await savePage(sql, {
      nodeId: page!.id,
      workspaceId: ws!.id,
      markdown: 'First paragraph about apples.\n\nSecond paragraph about bananas.\n',
      expectedContentHash: null,
      updatedBy: owner, changesetWindowMinutes: WINDOW_MINUTES,
    });
    await savePage(sql, {
      nodeId: page!.id,
      workspaceId: ws!.id,
      markdown: 'Second paragraph about bananas.\n\nFirst paragraph about apples.\n',
      expectedContentHash: first.contentHash,
      updatedBy: owner, changesetWindowMinutes: WINDOW_MINUTES,
    });
    const historyRows = await sql<{ id: string }[]>`
      SELECT id FROM page_revision WHERE page_id = ${page!.id} ORDER BY created_at ASC
    `;

    const app = buildApp();
    const res = await app.request(
      `/pages/${page!.id}/diff?from=${historyRows[0]!.id}&to=${historyRows[1]!.id}`,
      { headers: { cookie: await cookieFor(reader) } },
    );

    const body = (await res.json()) as { diff: { changes: (BlockChange & { text: string })[] } };
    expect(body.diff.changes.some((c) => c.kind === 'added' || c.kind === 'removed')).toBe(false);
    const moved = body.diff.changes.filter((c) => c.kind === 'moved');
    expect(moved).toHaveLength(2);
    expect(moved.every((c) => typeof c.text === 'string' && c.text.length > 0)).toBe(true);
    expect(moved.some((c) => c.text.includes('apples'))).toBe(true);
    expect(moved.some((c) => c.text.includes('bananas'))).toBe(true);
  });

  test('denied without read', async () => {
    const fixture = await buildPageFixture();
    const app = buildApp();

    const res = await app.request(
      `/pages/${fixture.pageId}/diff?from=${fixture.fromRevisionId}&to=${fixture.toRevisionId}`,
      { headers: { cookie: fixture.outsiderCookie } },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { diff?: unknown };
    expect(body.diff).toBeUndefined();
  });
});

describe('GET /books/:id/diff', () => {
  async function buildBookFixture() {
    const owner = await seedUser('Owner');
    const reader = await seedUser('Reader');
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
    `;
    const [root] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
    `;
    const [book] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${root!.id}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Operations Handbook') RETURNING id
    `;
    const [page] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${book!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Runbook') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${reader}, ${book!.id}, 'read', 'allow')
    `;

    const first = await savePage(sql, {
      nodeId: page!.id,
      workspaceId: ws!.id,
      markdown: 'Original.\n',
      expectedContentHash: null,
      updatedBy: owner,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const since = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await savePage(sql, {
      nodeId: page!.id,
      workspaceId: ws!.id,
      markdown: 'Original.\n\nAdded after the cutoff.\n',
      expectedContentHash: first.contentHash,
      updatedBy: owner,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    return {
      workspaceId: ws!.id,
      bookId: book!.id,
      pageId: page!.id,
      since,
      readerCookie: await cookieFor(reader),
    };
  }

  test('aggregates every page changed since the given date, with its page-level diff', async () => {
    const fixture = await buildBookFixture();
    const app = buildApp();

    const res = await app.request(`/books/${fixture.bookId}/diff?since=${encodeURIComponent(fixture.since.toISOString())}`, {
      headers: { cookie: fixture.readerCookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { pages: { pageId: string; diff: { changes: BlockChange[] } }[] };
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]?.pageId).toBe(fixture.pageId);
    expect(body.pages[0]?.diff.changes.some((change) => change.kind === 'added')).toBe(true);
  });

  // block-diff spec: carrying block text, both revision ids and the page
  // title directly avoids the web screen re-deriving revision ids from a
  // separate `GET /pages/:id/history` call per page and refetching text
  // from `GET /pages/:id/diff` — the N+1 `book-diff.ts`'s own comment says
  // it exists to avoid, reintroduced client-side otherwise.
  test('carries the book title/workspaceId, and each changed page carries its own text, revision ids and title', async () => {
    const fixture = await buildBookFixture();
    const app = buildApp();

    const res = await app.request(`/books/${fixture.bookId}/diff?since=${encodeURIComponent(fixture.since.toISOString())}`, {
      headers: { cookie: fixture.readerCookie },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      workspaceId: string;
      pages: {
        pageId: string;
        pageTitle: string;
        baselineRevisionId: string | null;
        latestRevisionId: string;
        diff: { changes: (BlockChange & { text: string })[] };
      }[];
    };

    expect(body.title).toBe('Operations Handbook');
    expect(body.workspaceId).toBe(fixture.workspaceId);

    const page = body.pages[0]!;
    expect(page.pageTitle).toBe('Runbook');
    expect(typeof page.baselineRevisionId === 'string' || page.baselineRevisionId === null).toBe(true);
    expect(page.baselineRevisionId).not.toBeNull();
    expect(typeof page.latestRevisionId).toBe('string');
    const added = page.diff.changes.find((change) => change.kind === 'added');
    expect(added?.text).toContain('Added after the cutoff');
  });

  // A page whose very first revision landed after `since` has no earlier
  // revision to diff against — `baselineRevisionId` must be `null`, not a
  // stand-in string, and the page's added blocks still carry text.
  test('a page with no revision before the cutoff reports a null baselineRevisionId', async () => {
    const owner = await seedUser('Owner');
    const reader = await seedUser('Reader');
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
    `;
    const [root] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
    `;
    const [book] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${root!.id}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Fresh Book') RETURNING id
    `;
    const [page] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${book!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Brand New Page') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${reader}, ${book!.id}, 'read', 'allow')
    `;
    const since = new Date(Date.now() - 1000);
    await savePage(sql, {
      nodeId: page!.id,
      workspaceId: ws!.id,
      markdown: 'Only revision.\n',
      expectedContentHash: null,
      updatedBy: owner,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const app = buildApp();
    const res = await app.request(`/books/${book!.id}/diff?since=${encodeURIComponent(since.toISOString())}`, {
      headers: { cookie: await cookieFor(reader) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { pages: { baselineRevisionId: string | null; pageTitle: string }[] };
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]!.baselineRevisionId).toBeNull();
    expect(body.pages[0]!.pageTitle).toBe('Brand New Page');
  });
});

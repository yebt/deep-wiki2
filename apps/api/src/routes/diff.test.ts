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

    const first = await savePage(sql, { nodeId: page!.id, workspaceId: ws!.id, markdown: 'One paragraph.\n', expectedContentHash: null, updatedBy: owner });
    const second = await savePage(sql, {
      nodeId: page!.id,
      workspaceId: ws!.id,
      markdown: 'One paragraph.\n\nA brand new paragraph.\n',
      expectedContentHash: first.contentHash,
      updatedBy: owner,
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
      VALUES (${ws!.id}, ${root!.id}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Book') RETURNING id
    `;
    const [page] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${book!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
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

    return { workspaceId: ws!.id, bookId: book!.id, pageId: page!.id, since, readerCookie: await cookieFor(reader) };
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
});

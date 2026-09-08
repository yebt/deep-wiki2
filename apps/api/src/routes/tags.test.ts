/**
 * Tag-filtered navigation resolves through can() (knowledge-graph spec:
 * Tag-Filtered Navigation Resolves Through can()).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession, savePage } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createTagRoutes } from './tags';

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

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, title: string) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${title}) RETURNING id
  `;
  return row!.id as string;
}

async function insertUser(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`${slug}-${crypto.randomUUID()}@example.com`}, 'hash', ${slug}) RETURNING id
  `;
  return row!.id as string;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function buildApp() {
  return createTagRoutes({ sql });
}

describe('GET /tags/:name/pages', () => {
  test('a page tagged with the name that the requester cannot read is excluded, with nothing disclosed', async () => {
    const owner = await insertUser('owner');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root', 'Root');
    const hiddenPage = await insertNode(ws!.id, root, 'page', 'hidden', 'Confidential Project Notes');
    await savePage(sql, { nodeId: hiddenPage, workspaceId: ws!.id, markdown: 'Body #project text.\n', expectedContentHash: null });
    const requester = await insertUser('requester');

    const app = buildApp();
    const res = await app.request(`/tags/project/pages?workspaceId=${ws!.id}`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expectNoDisclosure(body, { id: hiddenPage, slug: 'hidden', title: 'Confidential Project Notes' }, res.headers);
    expect((body as { pages: unknown[] }).pages).toEqual([]);
  });

  test('a readable page tagged with the name appears in the listing', async () => {
    const owner = await insertUser('owner2');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS2', ${`ws2-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root2', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'visible', 'Visible Project');
    await savePage(sql, { nodeId: page, workspaceId: ws!.id, markdown: 'Body #project text.\n', expectedContentHash: null });
    const requester = await insertUser('requester2');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${page}, 'read', 'allow')
    `;

    const app = buildApp();
    const res = await app.request(`/tags/project/pages?workspaceId=${ws!.id}`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { pages: { id: string }[] };
    expect(body.pages.map((p) => p.id)).toEqual([page]);
  });
});

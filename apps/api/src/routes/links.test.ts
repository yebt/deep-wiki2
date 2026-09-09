/**
 * Backlinks resolve through can() (knowledge-graph spec: Backlinks Resolve
 * Through can(), both scenarios). An unreadable source page must be
 * absent with nothing in the response revealing its title or existence,
 * and the reported count is computed after filtering.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession, savePage } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createLinkRoutes } from './links';

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
  return createLinkRoutes({ sql });
}

describe('GET /pages/:id/backlinks', () => {
  test('an unreadable source page is absent, with nothing revealing its title or existence', async () => {
    const owner = await insertUser('owner');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root', 'Root');
    const target = await insertNode(ws!.id, root, 'page', 'target', 'Target');
    const hiddenSource = await insertNode(ws!.id, root, 'page', 'hidden-source', 'Confidential Source');
    const requester = await insertUser('requester');

    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${target}, 'read', 'allow')
    `;
    // No grant on hiddenSource for requester: it stays unreadable.

    await savePage(sql, { nodeId: hiddenSource, workspaceId: ws!.id, markdown: `See [[Target]].\n`, expectedContentHash: null });

    const app = buildApp();
    const res = await app.request(`/pages/${target}/backlinks`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expectNoDisclosure(body, { id: hiddenSource, slug: 'hidden-source', title: 'Confidential Source' }, res.headers);
    expect((body as { total: number }).total).toBe(0);
  });

  test('a readable source page appears in the backlinks, and the count reflects it', async () => {
    const owner = await insertUser('owner2');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS2', ${`ws2-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root2', 'Root');
    const target = await insertNode(ws!.id, root, 'page', 'target2', 'Target2');
    const visibleSource = await insertNode(ws!.id, root, 'page', 'visible-source', 'Visible Source');
    const requester = await insertUser('requester2');

    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${target}, 'read', 'allow')
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${visibleSource}, 'read', 'allow')
    `;
    await savePage(sql, { nodeId: visibleSource, workspaceId: ws!.id, markdown: `See [[Target2]].\n`, expectedContentHash: null });

    const app = buildApp();
    const res = await app.request(`/pages/${target}/backlinks`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; pages: { id: string; title: string }[] };
    expect(body.total).toBe(1);
    expect(body.pages[0]!.id).toBe(visibleSource);
  });

  // The requester must be able to read the target page itself — and being
  // told so must not itself disclose that the page exists. Absence and
  // denial-of-read answer identically, exactly as the comment routes do.
  test('an unreadable target answers byte-identically to a target that does not exist', async () => {
    const owner = await insertUser('owner3');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS3', ${`ws3-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root3', 'Root');
    const target = await insertNode(ws!.id, root, 'page', 'target3', 'Target3');
    const requester = await insertUser('requester3');
    const cookie = await cookieFor(requester);
    const MISSING_PAGE_ID = '00000000-0000-4000-8000-0000000000fd';

    const app = buildApp();
    const denied = await app.request(`/pages/${target}/backlinks`, { headers: { cookie } });
    const missing = await app.request(`/pages/${MISSING_PAGE_ID}/backlinks`, { headers: { cookie } });

    const deniedBody = await denied.text();
    const missingBody = await missing.text();

    expect(denied.status).toBe(missing.status);
    expect(deniedBody).toBe(missingBody);
    expect(denied.status).toBe(404);
    expectNoDisclosure(deniedBody, { id: target, slug: 'target3', title: 'Target3' }, denied.headers);
  });
});

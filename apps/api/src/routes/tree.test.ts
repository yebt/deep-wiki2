/**
 * The navigation tree endpoint (navigation-tree spec) and drag-reorder
 * (PATCH /nodes/:id/position), both behind can().
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createTreeRoutes } from './tree';

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

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

interface Node {
  id: string;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<Node> {
  const [row] = await sql<Node[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', ${position}, ${slug}, ${slug})
    RETURNING id
  `;
  return row!;
}

async function grant(workspaceId: string, userId: string, resourceId: string, action: string) {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${userId}, ${resourceId}, ${action}::perm_action, 'allow')
  `;
}

async function deny(workspaceId: string, userId: string, resourceId: string, action: string) {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${userId}, ${resourceId}, ${action}::perm_action, 'deny')
  `;
}

interface Fixture {
  workspaceId: string;
  root: Node;
  shelf: Node;
  visibleBook: Node;
  hiddenChapter: Node;
  hiddenChapterPage: Node;
  readerCookie: string;
  writerCookie: string;
  writerId: string;
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
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const root = await insertNode(ws!.id, null, 'workspace', 'root');
  const shelf = await insertNode(ws!.id, root.id, 'shelf', 'shelf');
  const visibleBook = await insertNode(ws!.id, shelf.id, 'book', 'book-visible', 0);
  const hiddenChapter = await insertNode(ws!.id, visibleBook.id, 'chapter', 'chapter-hidden', 0);
  const hiddenChapterPage = await insertNode(ws!.id, hiddenChapter.id, 'page', 'page-under-hidden', 0);

  // The reader can read the shelf and the book, but the chapter carries an
  // explicit deny — most-specific-wins overrides the inherited allow from
  // the book above it, and the page under it inherits that deny in turn.
  await grant(ws!.id, reader!.id, shelf.id, 'read');
  await grant(ws!.id, reader!.id, visibleBook.id, 'read');
  await deny(ws!.id, reader!.id, hiddenChapter.id, 'read');

  await grant(ws!.id, writer!.id, shelf.id, 'write');
  await grant(ws!.id, writer!.id, visibleBook.id, 'write');
  await grant(ws!.id, writer!.id, hiddenChapter.id, 'write');
  await grant(ws!.id, writer!.id, hiddenChapterPage.id, 'write');

  return {
    workspaceId: ws!.id,
    root,
    shelf,
    visibleBook,
    hiddenChapter,
    hiddenChapterPage,
    readerCookie: await cookieFor(reader!.id),
    writerCookie: await cookieFor(writer!.id),
    writerId: writer!.id,
  };
}

function buildApp() {
  return createTreeRoutes({ sql, sessionIdleTimeoutMinutes: 30 });
}

function flatten(nodes: readonly { id: string; children: readonly unknown[] }[]): string[] {
  return nodes.flatMap((n) => [n.id, ...flatten(n.children as { id: string; children: readonly unknown[] }[])]);
}

// navigation-tree: Tree Displays Only Readable Nodes.
describe('GET /workspaces/:id/tree', () => {
  test('an unreadable chapter and its pages are absent from the tree', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request(`/workspaces/${fixture.workspaceId}/tree`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { rootId: string; nodes: { id: string; children: unknown[] }[] };
    expect(body.rootId).toBe(fixture.root.id);
    const ids = flatten(body.nodes as never);
    expect(ids).toContain(fixture.shelf.id);
    expect(ids).toContain(fixture.visibleBook.id);
    expect(ids).not.toContain(fixture.hiddenChapter.id);
    expect(ids).not.toContain(fixture.hiddenChapterPage.id);
  });
});

// navigation-tree: Drag Reorder Writes Back To Position; Reordering Requires Write Or Manage Permission.
describe('PATCH /nodes/:id/position', () => {
  test('a read-only subject cannot reorder', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.visibleBook.id}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ newParentId: fixture.shelf.id, newIndex: 0 }),
    });

    expect(res.status).toBe(403);
  });

  test('a writer can reorder a sibling and the new position persists', async () => {
    const fixture = await buildFixture();
    const app = buildApp();
    const secondBook = await insertNode(fixture.workspaceId, fixture.shelf.id, 'book', 'book-2', 1);
    await grant(fixture.workspaceId, fixture.writerId, secondBook.id, 'write');

    const res = await app.request(`/nodes/${secondBook.id}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ newParentId: fixture.shelf.id, newIndex: 0 }),
    });

    expect(res.status).toBe(200);
    const [row] = await sql<{ position: number }[]>`SELECT position FROM nodes WHERE id = ${secondBook.id}`;
    expect(row!.position).toBe(0);
  });
});

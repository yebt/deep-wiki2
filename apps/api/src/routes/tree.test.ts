/**
 * The navigation tree endpoint (navigation-tree spec) and drag-reorder
 * (PATCH /nodes/:id/position), both behind can().
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
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
  /** Holds nothing anywhere: no grant, no cell membership, owns no workspace. */
  outsiderCookie: string;
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
  // Deliberately granted nothing, ever. A non-disclosure test whose
  // subject can read something in the workspace proves nothing.
  const [outsider] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`outsider-${crypto.randomUUID()}@example.com`}, 'hash', 'Outsider') RETURNING id
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
    outsiderCookie: await cookieFor(outsider!.id),
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

/*
 * The test above proves a hidden *chapter* is absent from a member's tree.
 * It cannot fail if the endpoint answers a subject who is in no way part
 * of this workspace, because its subject is a member. This one varies the
 * caller instead: `rootId` is returned unconditionally and 200-versus-404
 * separates "exists" from "does not exist", so an outsider holding or
 * guessing a workspace UUID learns both that it exists and a valid
 * `resourceId` to aim other routes at.
 */
describe('GET /workspaces/:id/tree — an outsider cannot tell it apart from nothing', () => {
  test('a subject with no grant in the workspace gets exactly what a workspace that does not exist gets', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const denied = await app.request(`/workspaces/${fixture.workspaceId}/tree`, { headers: { cookie: fixture.outsiderCookie } });
    const absent = await app.request(`/workspaces/${crypto.randomUUID()}/tree`, { headers: { cookie: fixture.outsiderCookie } });

    const deniedBody = await denied.text();

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(denied.status);
    expect(deniedBody).toBe(await absent.text());
    expect(deniedBody).toBe(JSON.stringify({ error: 'not found' }));

    // The root id is the value that mattered: it is a legal `resourceId`
    // for can(), and therefore a legal `pageId` and `newParentId`.
    expectNoDisclosure(
      deniedBody,
      { id: fixture.root.id, slug: 'root', values: [fixture.shelf.id, fixture.visibleBook.id] },
      denied.headers,
    );
  });

  test('a member who can read only part of the workspace still gets its root', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request(`/workspaces/${fixture.workspaceId}/tree`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { rootId: string }).rootId).toBe(fixture.root.id);
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

  /*
   * ── The destination, and the branch the node leaves ────────────────
   *
   * The two cases above authorise the node being dragged and nothing
   * else, which is exactly the hole: `newParentId` reparents, and a move
   * is a write to two branches — the one that gains a child and the one
   * that loses it. `POST /nodes` one function down has always required
   * `write` on the parent to add a child there; putting an existing one
   * there is the same act.
   */
  test('moving a node under a parent the caller cannot read answers as if that parent did not exist, and does not move it', async () => {
    const fixture = await buildFixture();
    const app = buildApp();
    // A shelf the writer holds nothing on: it exists, and to them it is
    // invisible. Moving under it would publish the book to its readers.
    const secretShelf = await insertNode(fixture.workspaceId, fixture.root.id, 'shelf', 'shelf-secret', 1);

    const denied = await app.request(`/nodes/${fixture.visibleBook.id}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ newParentId: secretShelf.id, newIndex: 0 }),
    });
    const absent = await app.request(`/nodes/${fixture.visibleBook.id}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ newParentId: crypto.randomUUID(), newIndex: 0 }),
    });

    const deniedBody = await denied.text();

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(denied.status);
    expect(deniedBody).toBe(await absent.text());
    expectNoDisclosure(deniedBody, { id: secretShelf.id, slug: 'shelf-secret' }, denied.headers);

    const [row] = await sql<{ parent_id: string }[]>`SELECT parent_id FROM nodes WHERE id = ${fixture.visibleBook.id}`;
    expect(row!.parent_id).toBe(fixture.shelf.id);
  });

  test('moving a node under a parent the caller can read but not write is a 403, because that discloses nothing', async () => {
    const fixture = await buildFixture();
    const app = buildApp();
    const readOnlyShelf = await insertNode(fixture.workspaceId, fixture.root.id, 'shelf', 'shelf-read-only', 2);
    await grant(fixture.workspaceId, fixture.writerId, readOnlyShelf.id, 'read');

    const res = await app.request(`/nodes/${fixture.visibleBook.id}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ newParentId: readOnlyShelf.id, newIndex: 0 }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden');

    const [row] = await sql<{ parent_id: string }[]>`SELECT parent_id FROM nodes WHERE id = ${fixture.visibleBook.id}`;
    expect(row!.parent_id).toBe(fixture.shelf.id);
  });

  test('moving a node out of a branch the caller may only read is refused — removal changes that branch too', async () => {
    const fixture = await buildFixture();
    const app = buildApp();
    const [mover] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`mover-${crypto.randomUUID()}@example.com`}, 'hash', 'Mover') RETURNING id
    `;
    const destination = await insertNode(fixture.workspaceId, fixture.root.id, 'shelf', 'shelf-destination', 3);
    const book = await insertNode(fixture.workspaceId, fixture.shelf.id, 'book', 'book-depended-on', 4);

    // Everything the move needs except a right over the branch it leaves:
    // write on the node, write on the destination, read on the source.
    await grant(fixture.workspaceId, mover!.id, fixture.shelf.id, 'read');
    await grant(fixture.workspaceId, mover!.id, book.id, 'write');
    await grant(fixture.workspaceId, mover!.id, destination.id, 'write');

    const res = await app.request(`/nodes/${book.id}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: await cookieFor(mover!.id) },
      body: JSON.stringify({ newParentId: destination.id, newIndex: 0 }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden');

    const [row] = await sql<{ parent_id: string }[]>`SELECT parent_id FROM nodes WHERE id = ${book.id}`;
    expect(row!.parent_id).toBe(fixture.shelf.id);
  });

  // docs/TODO.md 2026-09-08 recorded this route as the one place still
  // answering 403 for exists-but-unreadable. `authorizeWrite` in the same
  // file already answers it correctly for creation and rename.
  test('reordering a node the caller cannot read answers as if it did not exist', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const denied = await app.request(`/nodes/${fixture.hiddenChapter.id}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ newParentId: fixture.visibleBook.id, newIndex: 0 }),
    });
    const absent = await app.request(`/nodes/${crypto.randomUUID()}/position`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ newParentId: fixture.visibleBook.id, newIndex: 0 }),
    });

    const deniedBody = await denied.text();

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(denied.status);
    expect(deniedBody).toBe(await absent.text());
    expectNoDisclosure(deniedBody, { id: fixture.hiddenChapter.id, slug: 'chapter-hidden' }, denied.headers);
  });
});

/*
 * ── Creation and rename ───────────────────────────────────────────────
 *
 * Three traps this suite is written to avoid, each of which would let a
 * green test sit on top of a broken rule:
 *
 * 1. **A creation test whose parent is always the workspace root
 *    exercises `LEGAL_PARENT_TYPES` not at all** — `shelf` is the only
 *    legal child of `workspace`, so every such test passes for the wrong
 *    reason. Every case below nests at least three levels deep, and both
 *    a legal and an illegal pairing are asserted, the illegal one naming
 *    the reason.
 * 2. **A non-disclosure test whose subject can read everything proves
 *    nothing.** The subject below is denied `read` on the chapter it
 *    tries to create under, and the assertion is that the refusal is
 *    byte-identical to the refusal for an id that does not exist — body
 *    and headers both, through the shared helper.
 * 3. **A slug-collision test that never actually collides passes
 *    trivially.** The collision below is produced by asking for the same
 *    title twice through the route itself.
 */
describe('POST /nodes', () => {
  test('a writer creates a page inside a chapter, three levels below the root', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ parentId: fixture.hiddenChapter.id, type: 'page', title: 'Local Development Setup' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; slug: string; type: string; parentId: string; position: number };
    expect(body.slug).toBe('local-development-setup');
    expect(body.type).toBe('page');
    expect(body.parentId).toBe(fixture.hiddenChapter.id);

    const [row] = await sql<{ workspace_id: string; title: string; parent_id: string }[]>`
      SELECT workspace_id, title, parent_id FROM nodes WHERE id = ${body.id}
    `;
    expect(row!.workspace_id).toBe(fixture.workspaceId);
    expect(row!.parent_id).toBe(fixture.hiddenChapter.id);
    expect(row!.title).toBe('Local Development Setup');
  });

  test('a book under a page is refused, and the refusal names both types', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ parentId: fixture.hiddenChapterPage.id, type: 'book', title: 'Handbook' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('"book"');
    expect(body.error).toContain('"page"');

    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE parent_id = ${fixture.hiddenChapterPage.id}`;
    expect(rows).toHaveLength(0);
  });

  test('a shelf under a book is refused — the same table that refuses moving one there', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ parentId: fixture.visibleBook.id, type: 'shelf', title: 'Design' }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('"shelf"');
  });

  test('creating under a parent the caller cannot read answers exactly as creating under one that does not exist', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    // The reader carries an explicit deny on this chapter (most-specific
    // wins), so it exists and is invisible to them.
    const denied = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ parentId: fixture.hiddenChapter.id, type: 'page', title: 'Probe' }),
    });
    const absent = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ parentId: crypto.randomUUID(), type: 'page', title: 'Probe' }),
    });

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(denied.status);

    const deniedBody = await denied.text();
    expect(deniedBody).toBe(await absent.text());
    expect(deniedBody).toBe(JSON.stringify({ error: 'not found' }));

    // Headers as well as body: `headers` is required on this helper
    // precisely because an optional channel is one a call site skips.
    expectNoDisclosure(deniedBody, { id: fixture.hiddenChapter.id, slug: 'chapter-hidden', title: 'chapter-hidden' }, denied.headers);

    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE parent_id = ${fixture.hiddenChapter.id} AND slug = 'probe'`;
    expect(rows).toHaveLength(0);
  });

  test('a subject who can read the parent but not write it is told so, because that discloses nothing', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ parentId: fixture.visibleBook.id, type: 'chapter', title: 'Notes' }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden');
  });

  test('a second sibling with the same name is refused by name, not by a constraint violation', async () => {
    const fixture = await buildFixture();
    const app = buildApp();
    const create = () =>
      app.request('/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
        body: JSON.stringify({ parentId: fixture.hiddenChapter.id, type: 'page', title: 'Getting Started' }),
      });

    const first = await create();
    expect(first.status).toBe(201);

    const second = await create();
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toContain('Getting Started');

    const rows = await sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE parent_id = ${fixture.hiddenChapter.id} AND slug = 'getting-started'
    `;
    expect(rows).toHaveLength(1);
  });

  test('a title with nothing sluggable in it is refused before it reaches the database', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ parentId: fixture.hiddenChapter.id, type: 'page', title: '###' }),
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/letter or number/i);
  });

  test('a malformed body is a 400, not a 500', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request('/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ parentId: fixture.hiddenChapter.id, title: 'No type' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /nodes/:id', () => {
  test('a writer renames a node, and the slug follows the title', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.hiddenChapterPage.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ title: 'Renamed Page' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string; slug: string; title: string }).toEqual({
      id: fixture.hiddenChapterPage.id,
      slug: 'renamed-page',
      title: 'Renamed Page',
    });

    const [row] = await sql<{ title: string; slug: string }[]>`
      SELECT title, slug FROM nodes WHERE id = ${fixture.hiddenChapterPage.id}
    `;
    expect(row!.title).toBe('Renamed Page');
    expect(row!.slug).toBe('renamed-page');
  });

  test('renaming a node the caller cannot read answers as if it did not exist, disclosing nothing', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const denied = await app.request(`/nodes/${fixture.hiddenChapter.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ title: 'Probe' }),
    });
    const absent = await app.request(`/nodes/${crypto.randomUUID()}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ title: 'Probe' }),
    });

    expect(denied.status).toBe(404);
    const deniedBody = await denied.text();
    expect(deniedBody).toBe(await absent.text());
    expectNoDisclosure(deniedBody, { id: fixture.hiddenChapter.id, slug: 'chapter-hidden', title: 'chapter-hidden' }, denied.headers);

    const [row] = await sql<{ title: string }[]>`SELECT title FROM nodes WHERE id = ${fixture.hiddenChapter.id}`;
    expect(row!.title).toBe('chapter-hidden');
  });

  test('a read-only subject cannot rename', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.visibleBook.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ title: 'Nope' }),
    });

    expect(res.status).toBe(403);
  });

  test('renaming onto a sibling’s name is the same refusal creation gives', async () => {
    const fixture = await buildFixture();
    const app = buildApp();
    const sibling = await insertNode(fixture.workspaceId, fixture.hiddenChapter.id, 'page', 'overview', 1);
    await grant(fixture.workspaceId, fixture.writerId, sibling.id, 'write');

    const res = await app.request(`/nodes/${fixture.hiddenChapterPage.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: fixture.writerCookie },
      body: JSON.stringify({ title: 'Overview' }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('Overview');
  });
});

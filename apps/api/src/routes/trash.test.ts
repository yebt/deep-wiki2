/**
 * `apps/api/src/routes/trash.ts` (node-trash, trash-restore specs;
 * design.md Decision 3/4/7).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createTrashRoutes } from './trash';

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

async function insertUser(displayName = 'U'): Promise<{ id: string; cookie: Promise<string> }> {
  const id = crypto.randomUUID();
  await sql`INSERT INTO users (id, email, password_hash, display_name) VALUES (${id}, ${`u-${id}@example.com`}, 'hash', ${displayName})`;
  return { id, cookie: cookieFor(id) };
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<Node> {
  const [row] = await sql<Node[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', ${position}, ${slug}, ${slug})
    RETURNING id
  `;
  return row!;
}

async function grant(workspaceId: string, userId: string, resourceId: string, action: string): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${userId}, ${resourceId}, ${action}::perm_action, 'allow')
  `;
}

interface Fixture {
  workspaceId: string;
  workspaceSlug: string;
  ownerId: string;
  ownerCookie: string;
  root: Node;
  book: Node;
  page: Node;
}

async function buildWorkspace(): Promise<Fixture> {
  const owner = await insertUser('Owner');
  const workspaceSlug = `ws-${crypto.randomUUID()}`;
  const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner.id}, 'WS', ${workspaceSlug}) RETURNING id`;
  const root = await insertNode(ws!.id, null, 'workspace', 'root');
  const book = await insertNode(ws!.id, root.id, 'book', 'book');
  const page = await insertNode(ws!.id, book.id, 'page', 'page');
  await grant(ws!.id, owner.id, root.id, 'manage');

  return {
    workspaceId: ws!.id,
    workspaceSlug,
    ownerId: owner.id,
    ownerCookie: await owner.cookie,
    root,
    book,
    page,
  };
}

function buildApp() {
  return createTrashRoutes({ sql, sessionIdleTimeoutMinutes: 30 });
}

describe('DELETE /nodes/:id', () => {
  test('a manage subject trashes an empty container', async () => {
    const fixture = await buildWorkspace();
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.page.id}`, { method: 'DELETE', headers: { cookie: fixture.ownerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { trashOperationId: string; trashed: { pages: number; containers: number } };
    expect(body.trashOperationId).toEqual(expect.any(String));
    expect(body.trashed).toEqual({ pages: 0, containers: 0 });

    const [row] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${fixture.page.id}`;
    expect(row!.trashed_at).not.toBeNull();
  });

  test('a non-empty container is refused with 409 not_empty for a non-owner manager', async () => {
    const fixture = await buildWorkspace();
    const manager = await insertUser('Manager');
    await grant(fixture.workspaceId, manager.id, fixture.book.id, 'manage');
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.book.id}`, { method: 'DELETE', headers: { cookie: await manager.cookie } });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; pages: number; containers: number; canForce: boolean };
    expect(body).toEqual({ error: 'not_empty', pages: 1, containers: 0, canForce: false });

    const [row] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${fixture.book.id}`;
    expect(row!.trashed_at).toBeNull();
  });

  test('a subject with no read grant gets 404, identical to an unknown id', async () => {
    const fixture = await buildWorkspace();
    const outsider = await insertUser('Outsider');
    const app = buildApp();

    const [known, unknown] = await Promise.all([
      app.request(`/nodes/${fixture.page.id}`, { method: 'DELETE', headers: { cookie: await outsider.cookie } }),
      app.request(`/nodes/${crypto.randomUUID()}`, { method: 'DELETE', headers: { cookie: await outsider.cookie } }),
    ]);

    expect(known.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await known.json()).toEqual(await unknown.json());
  });

  test('read but no manage and not owner gets a named 403', async () => {
    const fixture = await buildWorkspace();
    const reader = await insertUser('Reader');
    await grant(fixture.workspaceId, reader.id, fixture.page.id, 'read');
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.page.id}`, { method: 'DELETE', headers: { cookie: await reader.cookie } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });
});

describe('POST /nodes/:id/force-delete', () => {
  test('correct name and current count succeeds', async () => {
    const fixture = await buildWorkspace();
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.book.id}/force-delete`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmName: 'book', acceptedCount: 1 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { trashed: { pages: number } };
    expect(body.trashed.pages).toBe(1);
  });

  test('a mismatched name is refused with 409 name_mismatch', async () => {
    const fixture = await buildWorkspace();
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.book.id}/force-delete`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmName: 'wrong-name', acceptedCount: 1 }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_mismatch' });
  });

  test('a stale count is refused with 409 stale_count naming the fresh count', async () => {
    const fixture = await buildWorkspace();
    await insertNode(fixture.workspaceId, fixture.book.id, 'page', 'second-page', 1);
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.book.id}/force-delete`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmName: 'book', acceptedCount: 1 }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stale_count', pages: 2, containers: 0 });
  });

  test('a non-owner manager cannot force-delete', async () => {
    const fixture = await buildWorkspace();
    const manager = await insertUser('Manager');
    await grant(fixture.workspaceId, manager.id, fixture.book.id, 'manage');
    const app = buildApp();

    const res = await app.request(`/nodes/${fixture.book.id}/force-delete`, {
      method: 'POST',
      headers: { cookie: await manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmName: 'book', acceptedCount: 1 }),
    });

    expect(res.status).toBe(403);
  });
});

describe('GET /workspaces/:ref/trash', () => {
  test('shows only what the subject may manage, by workspace id or slug', async () => {
    const fixture = await buildWorkspace();
    const manager = await insertUser('Manager');
    await grant(fixture.workspaceId, manager.id, fixture.page.id, 'manage');
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()}, trashed_by = ${fixture.ownerId} WHERE id = ${fixture.page.id}`;

    const otherPage = await insertNode(fixture.workspaceId, fixture.book.id, 'page', 'other-page', 1);
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()}, trashed_by = ${fixture.ownerId} WHERE id = ${otherPage.id}`;

    const app = buildApp();
    const byId = await app.request(`/workspaces/${fixture.workspaceId}/trash`, { headers: { cookie: await manager.cookie } });
    const bySlug = await app.request(`/workspaces/${fixture.workspaceSlug}/trash`, { headers: { cookie: await manager.cookie } });

    expect(byId.status).toBe(200);
    const body = (await byId.json()) as { items: { root: { id: string } }[] };
    expect(body.items.map((item) => item.root.id)).toEqual([fixture.page.id]);
    expect((await bySlug.json() as typeof body).items.map((item) => item.root.id)).toEqual([fixture.page.id]);
  });

  test('a subject with no manage grant anywhere sees an empty listing', async () => {
    const fixture = await buildWorkspace();
    const outsiderReader = await insertUser('Reader');
    await grant(fixture.workspaceId, outsiderReader.id, fixture.root.id, 'read');
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()}, trashed_by = ${fixture.ownerId} WHERE id = ${fixture.page.id}`;
    const app = buildApp();

    const res = await app.request(`/workspaces/${fixture.workspaceId}/trash`, { headers: { cookie: await outsiderReader.cookie } });

    expect(res.status).toBe(200);
    expect((await res.json()) as { items: unknown[] }).toEqual({ items: [] });
  });

  test('an unreadable workspace answers 404', async () => {
    const fixture = await buildWorkspace();
    const outsider = await insertUser('Outsider');
    const app = buildApp();

    const res = await app.request(`/workspaces/${fixture.workspaceId}/trash`, { headers: { cookie: await outsider.cookie } });
    expect(res.status).toBe(404);
  });
});

describe('POST /trash/:operationId/restore', () => {
  async function trashPage(fixture: Fixture): Promise<string> {
    const opId = crypto.randomUUID();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${opId}, trashed_by = ${fixture.ownerId} WHERE id = ${fixture.page.id}`;
    await sql`
      INSERT INTO node_deletions (workspace_id, book_id, node_id, node_type, title, location, event, trash_operation_id, actor_id, page_count, restricted)
      VALUES (${fixture.workspaceId}, ${fixture.book.id}, ${fixture.page.id}, 'page'::node_type, 'page', 'book', 'trashed', ${opId}, ${fixture.ownerId}, 0, false)
    `;
    return opId;
  }

  test('restores under the original slug with no collision', async () => {
    const fixture = await buildWorkspace();
    const opId = await trashPage(fixture);
    const app = buildApp();

    const res = await app.request(`/trash/${opId}/restore`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe('page');
  });

  test('a slug collision answers 409 naming the live sibling', async () => {
    const fixture = await buildWorkspace();
    const opId = await trashPage(fixture);
    await insertNode(fixture.workspaceId, fixture.book.id, 'page', 'page', 1);
    const app = buildApp();

    const res = await app.request(`/trash/${opId}/restore`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'slug_taken', sibling: { title: 'page' } });
  });

  test('restore-as succeeds with the typed name after a collision', async () => {
    const fixture = await buildWorkspace();
    const opId = await trashPage(fixture);
    await insertNode(fixture.workspaceId, fixture.book.id, 'page', 'page', 1);
    const app = buildApp();

    const res = await app.request(`/trash/${opId}/restore`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'page-2026' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { slug: string }).toEqual(expect.objectContaining({ slug: 'page-2026' }));
  });

  test('an ancestor still trashed refuses, naming the ancestor', async () => {
    const fixture = await buildWorkspace();
    const bookOpId = crypto.randomUUID();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${bookOpId}, trashed_by = ${fixture.ownerId} WHERE id = ${fixture.book.id}`;
    const pageOpId = crypto.randomUUID();
    await sql`UPDATE nodes SET trashed_at = now() - interval '1 hour', trash_operation_id = ${pageOpId}, trashed_by = ${fixture.ownerId} WHERE id = ${fixture.page.id}`;
    await sql`
      INSERT INTO node_deletions (workspace_id, book_id, node_id, node_type, title, location, event, trash_operation_id, actor_id, page_count, restricted)
      VALUES (${fixture.workspaceId}, ${fixture.book.id}, ${fixture.page.id}, 'page'::node_type, 'page', 'book', 'trashed', ${pageOpId}, ${fixture.ownerId}, 0, false)
    `;
    const app = buildApp();

    const res = await app.request(`/trash/${pageOpId}/restore`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'ancestor_trashed', ancestor: { title: 'book' } });
  });

  test('an unknown operation id answers 404', async () => {
    const fixture = await buildWorkspace();
    const app = buildApp();

    const res = await app.request(`/trash/${crypto.randomUUID()}/restore`, {
      method: 'POST',
      headers: { cookie: fixture.ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });

  test('a caller who cannot manage the operation root gets the same 404 an unknown op gets', async () => {
    const fixture = await buildWorkspace();
    const opId = await trashPage(fixture);
    const outsider = await insertUser('Outsider');
    const app = buildApp();

    const [known, unknown] = await Promise.all([
      app.request(`/trash/${opId}/restore`, { method: 'POST', headers: { cookie: await outsider.cookie, 'content-type': 'application/json' }, body: '{}' }),
      app.request(`/trash/${crypto.randomUUID()}/restore`, {
        method: 'POST',
        headers: { cookie: await outsider.cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    ]);

    expect(known.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await known.json()).toEqual(await unknown.json());
  });
});

describe('GET /trash/nodes/:id', () => {
  test('the manager who trashed it can look it up; an outsider gets 404', async () => {
    const fixture = await buildWorkspace();
    const opId = crypto.randomUUID();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${opId}, trashed_by = ${fixture.ownerId} WHERE id = ${fixture.page.id}`;
    const outsider = await insertUser('Outsider');
    const app = buildApp();

    const managerRes = await app.request(`/trash/nodes/${fixture.page.id}`, { headers: { cookie: fixture.ownerCookie } });
    const outsiderRes = await app.request(`/trash/nodes/${fixture.page.id}`, { headers: { cookie: await outsider.cookie } });

    expect(managerRes.status).toBe(200);
    expect(outsiderRes.status).toBe(404);
  });
});

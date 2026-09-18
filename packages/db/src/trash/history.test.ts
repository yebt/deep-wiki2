/**
 * `listBookDeletions()` — the raw, unfiltered read the changesets spec's
 * "History Response Carries Deletions Alongside Changesets" scenario needs.
 * Visibility filtering of a `restricted` row is proven at the route layer
 * (`apps/api/src/routes/revisions.test.ts`), not here.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { listBookDeletions } from './history';

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

async function seedWorkspace(): Promise<{ workspaceId: string; ownerId: string }> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  return { workspaceId: workspace!.id, ownerId: user!.id };
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug})
    RETURNING id
  `;
  return row!;
}

async function insertTrace(
  workspaceId: string,
  bookId: string,
  nodeId: string,
  event: 'trashed' | 'restored' | 'purged',
  actorId: string | null,
  restricted = false,
): Promise<void> {
  await sql`
    INSERT INTO node_deletions (workspace_id, book_id, node_id, node_type, title, location, event, trash_operation_id, actor_id, page_count, restricted)
    VALUES (${workspaceId}, ${bookId}, ${nodeId}, 'page'::node_type, 'Overview', 'Shelf › Book', ${event}, ${crypto.randomUUID()}, ${actorId}, 1, ${restricted})
  `;
}

describe('listBookDeletions', () => {
  test('returns every trace row for the book, newest first', async () => {
    const { workspaceId, ownerId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const book = await insertNode(workspaceId, root.id, 'book', 'book');
    const page = await insertNode(workspaceId, book.id, 'page', 'page');

    await insertTrace(workspaceId, book.id, page.id, 'trashed', ownerId);
    await insertTrace(workspaceId, book.id, page.id, 'restored', ownerId);

    const rows = await listBookDeletions(sql, { bookId: book.id, workspaceId });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.event)).toEqual(['restored', 'trashed']);
    expect(rows[0]!.actorDisplayName).toBe('Owner');
  });

  test('a different book has no rows here', async () => {
    const { workspaceId, ownerId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const book = await insertNode(workspaceId, root.id, 'book', 'book');
    const otherBook = await insertNode(workspaceId, root.id, 'book', 'other-book');
    const page = await insertNode(workspaceId, book.id, 'page', 'page');
    await insertTrace(workspaceId, book.id, page.id, 'trashed', ownerId);

    expect(await listBookDeletions(sql, { bookId: otherBook.id, workspaceId })).toEqual([]);
  });

  test('carries the restricted flag unfiltered', async () => {
    const { workspaceId, ownerId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const book = await insertNode(workspaceId, root.id, 'book', 'book');
    const page = await insertNode(workspaceId, book.id, 'page', 'page');
    await insertTrace(workspaceId, book.id, page.id, 'trashed', ownerId, true);

    const [row] = await listBookDeletions(sql, { bookId: book.id, workspaceId });
    expect(row!.restricted).toBe(true);
    expect(row!.title).toBe('Overview');
  });
});

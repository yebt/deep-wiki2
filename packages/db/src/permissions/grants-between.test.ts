/**
 * `hasGrantsBetween` truth table (deletion-trace spec — restricted trace
 * snapshot): a grant strictly below the book among the operation's ids
 * makes the trace `restricted`; no such grant means the node's readability
 * was the book's by construction.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { hasGrantsBetween } from './grants-between';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

interface Row {
  id: string;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string): Promise<Row> {
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug})
    RETURNING id
  `;
  return row!;
}

async function seedWorkspace(): Promise<{ workspaceId: string; ownerId: string }> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  return { workspaceId: workspace!.id, ownerId: user!.id };
}

async function grant(workspaceId: string, resourceId: string, subjectId: string): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${subjectId}, ${resourceId}, 'read', 'allow')
  `;
}

describe('hasGrantsBetween — restricted trace snapshot', () => {
  test('no grant on any op id below the book: not restricted', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'chapter');

    expect(await hasGrantsBetween(sql, { workspaceId, bookId: book.id, nodeIds: [chapter.id] })).toBe(false);
  });

  test('a grant directly on the trashed node itself: restricted', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'chapter');
    const page = await insertNode(workspaceId, chapter.id, 'page', 'page');
    const u = await sql<{ id: string }[]>`INSERT INTO users (email, password_hash, display_name) VALUES (${`u-${crypto.randomUUID()}@example.com`}, 'hash', 'U') RETURNING id`;
    await grant(workspaceId, page.id, u[0]!.id);

    expect(await hasGrantsBetween(sql, { workspaceId, bookId: book.id, nodeIds: [chapter.id, page.id] })).toBe(true);
  });

  test('a grant on the book itself is not "below the book" and does not count', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const u = await sql<{ id: string }[]>`INSERT INTO users (email, password_hash, display_name) VALUES (${`u-${crypto.randomUUID()}@example.com`}, 'hash', 'U') RETURNING id`;
    await grant(workspaceId, book.id, u[0]!.id);

    expect(await hasGrantsBetween(sql, { workspaceId, bookId: book.id, nodeIds: [book.id] })).toBe(false);
  });

  test('a null bookId (shelf, no book ancestor) still detects a grant on the op ids', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const u = await sql<{ id: string }[]>`INSERT INTO users (email, password_hash, display_name) VALUES (${`u-${crypto.randomUUID()}@example.com`}, 'hash', 'U') RETURNING id`;
    await grant(workspaceId, shelf.id, u[0]!.id);

    expect(await hasGrantsBetween(sql, { workspaceId, bookId: null, nodeIds: [shelf.id] })).toBe(true);
  });

  test('an empty nodeIds set is never restricted', async () => {
    const { workspaceId } = await seedWorkspace();
    expect(await hasGrantsBetween(sql, { workspaceId, bookId: null, nodeIds: [] })).toBe(false);
  });
});

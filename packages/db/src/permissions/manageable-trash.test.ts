/**
 * `manageableTrashRoots` truth table (trash-restore spec — "Trash Listing
 * Shows Only What The Subject May Manage").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { manageableTrashRoots } from './manageable-trash';

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

async function insertNode(
  workspaceId: string,
  parentId: string | null,
  type: string,
  slug: string,
  opts: { trashed?: boolean; trashOperationId?: string; trashedBy?: string } = {},
): Promise<Row> {
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title, trashed_at, trash_operation_id, trashed_by)
    VALUES (
      ${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug},
      ${opts.trashed ? sql`now()` : null},
      ${opts.trashOperationId ?? null},
      ${opts.trashedBy ?? null}
    )
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

async function insertUser(): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`u-${crypto.randomUUID()}@example.com`}, 'hash', 'U') RETURNING id
  `;
  return row!.id;
}

async function grant(workspaceId: string, resourceId: string, subjectId: string, action: 'manage' | 'read' = 'manage'): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${subjectId}, ${resourceId}, ${action}, 'allow')
  `;
}

describe('manageableTrashRoots', () => {
  test('two trashed pages, one manageable and one not: only the manageable one appears', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const opA = crypto.randomUUID();
    const opB = crypto.randomUUID();
    const pageA = await insertNode(workspaceId, book.id, 'page', 'page-a', { trashed: true, trashOperationId: opA });
    await insertNode(workspaceId, book.id, 'page', 'page-b', { trashed: true, trashOperationId: opB });

    const u = await insertUser();
    await grant(workspaceId, pageA.id, u, 'manage');

    const result = await manageableTrashRoots(sql, { workspaceId, subjectType: 'user', subjectId: u });

    expect(result.map((r) => r.id)).toEqual([pageA.id]);
  });

  test('a subject with no manage grant anywhere sees an empty listing', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const op = crypto.randomUUID();
    await insertNode(workspaceId, book.id, 'page', 'page', { trashed: true, trashOperationId: op });

    const u = await insertUser();

    expect(await manageableTrashRoots(sql, { workspaceId, subjectType: 'user', subjectId: u })).toEqual([]);
  });

  test('a `read`-only grant on a trashed node does not make it manageable', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const op = crypto.randomUUID();
    const page = await insertNode(workspaceId, book.id, 'page', 'page', { trashed: true, trashOperationId: op });
    const u = await insertUser();
    await grant(workspaceId, page.id, u, 'read');

    expect(await manageableTrashRoots(sql, { workspaceId, subjectType: 'user', subjectId: u })).toEqual([]);
  });

  test('only the co-trashed subtree root is returned, not its descendants sharing the same operation', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const op = crypto.randomUUID();
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book', { trashed: true, trashOperationId: op });
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'chapter', { trashed: true, trashOperationId: op });
    await insertNode(workspaceId, chapter.id, 'page', 'page', { trashed: true, trashOperationId: op });

    const u = await insertUser();
    await grant(workspaceId, book.id, u, 'manage');

    const result = await manageableTrashRoots(sql, { workspaceId, subjectType: 'user', subjectId: u });
    expect(result.map((r) => r.id)).toEqual([book.id]);
  });

  test('a node trashed under a different, earlier operation than its now-trashed parent is its own root', async () => {
    const { workspaceId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const opPage = crypto.randomUUID();
    const opChapter = crypto.randomUUID();
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'chapter', { trashed: true, trashOperationId: opChapter });
    const page = await insertNode(workspaceId, chapter.id, 'page', 'page', { trashed: true, trashOperationId: opPage });

    const u = await insertUser();
    await grant(workspaceId, chapter.id, u, 'manage');
    await grant(workspaceId, page.id, u, 'manage');

    const result = await manageableTrashRoots(sql, { workspaceId, subjectType: 'user', subjectId: u });
    expect(result.map((r) => r.id).sort()).toEqual([chapter.id, page.id].sort());
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { CrossWorkspaceMoveError, CyclicMoveError, IllegalParentTypeError, moveNode } from './move';

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
  path: string;
  parent_id: string | null;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<Row> {
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', ${position}, ${slug}, ${slug})
    RETURNING id, path, parent_id
  `;
  return row!;
}

async function seedWorkspace(): Promise<string> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 10, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  return workspace!.id as string;
}

async function currentPath(id: string): Promise<string> {
  const [row] = await sql<{ path: string }[]>`SELECT path FROM nodes WHERE id = ${id}`;
  return row!.path;
}

describe('moveNode — subtree move rewrites path (tenancy-model)', () => {
  test('a reparented chapter carries its pages rewritten paths', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const bookA = await insertNode(workspaceId, shelf.id, 'book', 'book-a');
    const bookB = await insertNode(workspaceId, shelf.id, 'book', 'book-b', 1);
    const chapter = await insertNode(workspaceId, bookA.id, 'chapter', 'chapter');
    const page1 = await insertNode(workspaceId, chapter.id, 'page', 'page-1');
    const page2 = await insertNode(workspaceId, chapter.id, 'page', 'page-2', 1);

    await moveNode(sql, { nodeId: chapter.id, newParentId: bookB.id });

    const chapterPath = await currentPath(chapter.id);
    const bookBPath = await currentPath(bookB.id);
    expect(chapterPath.startsWith(bookBPath)).toBe(true);

    const page1Path = await currentPath(page1.id);
    const page2Path = await currentPath(page2.id);
    expect(page1Path.startsWith(chapterPath)).toBe(true);
    expect(page2Path.startsWith(chapterPath)).toBe(true);
    expect(page1Path.endsWith(`${page1.id}/`)).toBe(true);
    expect(page2Path.endsWith(`${page2.id}/`)).toBe(true);
  });

  test('a move across workspaces is rejected rather than changing workspace_id', async () => {
    const workspaceA = await seedWorkspace();
    const workspaceB = await seedWorkspace();
    const rootA = await insertNode(workspaceA, null, 'workspace', 'root-a');
    const shelfA = await insertNode(workspaceA, rootA.id, 'shelf', 'shelf-a');
    const rootB = await insertNode(workspaceB, null, 'workspace', 'root-b');
    const shelfB = await insertNode(workspaceB, rootB.id, 'shelf', 'shelf-b');

    let error: unknown;
    try {
      await moveNode(sql, { nodeId: shelfA.id, newParentId: rootB.id });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrossWorkspaceMoveError);

    const [after] = await sql<{ workspace_id: string; parent_id: string | null }[]>`
      SELECT workspace_id, parent_id FROM nodes WHERE id = ${shelfA.id}
    `;
    expect(after!.workspace_id).toBe(workspaceA);
    expect(after!.parent_id).toBe(rootA.id);
    void shelfB;
  });

  test('a cycle is rejected: the new parent cannot be a descendant of the moved node', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'chapter');

    let error: unknown;
    try {
      await moveNode(sql, { nodeId: book.id, newParentId: chapter.id });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CyclicMoveError);
  });

  test('an illegal parent type is rejected', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    // Two unrelated branches, so this is a type-legality violation and
    // not also a cycle: bookB is not an ancestor of pageA.
    const bookA = await insertNode(workspaceId, shelf.id, 'book', 'book-a');
    const bookB = await insertNode(workspaceId, shelf.id, 'book', 'book-b', 1);
    const pageA = await insertNode(workspaceId, bookA.id, 'page', 'page-a');

    let error: unknown;
    try {
      // a book can never be a legal child of a page
      await moveNode(sql, { nodeId: bookB.id, newParentId: pageA.id });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IllegalParentTypeError);
  });

  test('concurrent moves in the same workspace serialise on the workspace row lock', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const bookA = await insertNode(workspaceId, shelf.id, 'book', 'book-a');
    const bookB = await insertNode(workspaceId, shelf.id, 'book', 'book-b', 1);
    const bookC = await insertNode(workspaceId, shelf.id, 'book', 'book-c', 2);
    const chapter1 = await insertNode(workspaceId, bookA.id, 'chapter', 'chapter-1');
    const chapter2 = await insertNode(workspaceId, bookB.id, 'chapter', 'chapter-2');

    const results = await Promise.allSettled([
      moveNode(sql, { nodeId: chapter1.id, newParentId: bookC.id }),
      moveNode(sql, { nodeId: chapter2.id, newParentId: bookC.id }),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const chapter1Path = await currentPath(chapter1.id);
    const chapter2Path = await currentPath(chapter2.id);
    const bookCPath = await currentPath(bookC.id);

    expect(chapter1Path.startsWith(bookCPath)).toBe(true);
    expect(chapter2Path.startsWith(bookCPath)).toBe(true);
  });
});

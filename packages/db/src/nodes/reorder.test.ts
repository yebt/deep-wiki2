import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { CrossWorkspaceMoveError } from './move';
import { reorderNode } from './reorder';

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

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<{ id: string; path: string }> {
  const [row] = await sql<{ id: string; path: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', ${position}, ${slug}, ${slug})
    RETURNING id, path
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

async function positionsUnder(parentId: string): Promise<{ id: string; position: number }[]> {
  const rows = await sql<{ id: string; position: number }[]>`
    SELECT id, position FROM nodes WHERE parent_id = ${parentId} ORDER BY position ASC
  `;
  return rows;
}

// navigation-tree: Drag Reorder Writes Back To Position.
describe('reorderNode', () => {
  test('dragging the third sibling to the first position persists distinct positions in the new order', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const bookA = await insertNode(workspaceId, shelf.id, 'book', 'book-a', 0);
    const bookB = await insertNode(workspaceId, shelf.id, 'book', 'book-b', 1);
    const bookC = await insertNode(workspaceId, shelf.id, 'book', 'book-c', 2);

    await reorderNode(sql, { nodeId: bookC.id, newParentId: shelf.id, newIndex: 0 });

    const ordered = await positionsUnder(shelf.id);
    expect(ordered.map((r) => r.id)).toEqual([bookC.id, bookA.id, bookB.id]);
    const positions = ordered.map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  test('a cross-workspace drag target is rejected without changing workspace_id', async () => {
    const workspaceA = await seedWorkspace();
    const workspaceB = await seedWorkspace();
    const rootA = await insertNode(workspaceA, null, 'workspace', 'root-a');
    const shelfA = await insertNode(workspaceA, rootA.id, 'shelf', 'shelf-a');
    const rootB = await insertNode(workspaceB, null, 'workspace', 'root-b');

    let error: unknown;
    try {
      await reorderNode(sql, { nodeId: shelfA.id, newParentId: rootB.id, newIndex: 0 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrossWorkspaceMoveError);

    const [after] = await sql<{ workspace_id: string }[]>`SELECT workspace_id FROM nodes WHERE id = ${shelfA.id}`;
    expect(after!.workspace_id).toBe(workspaceA);
  });

  test('reparenting to a new parent inserts at the requested index among its existing children', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const bookA = await insertNode(workspaceId, shelf.id, 'book', 'book-a', 0);
    const bookB = await insertNode(workspaceId, shelf.id, 'book', 'book-b', 1);
    const chapter1 = await insertNode(workspaceId, bookA.id, 'chapter', 'chapter-1', 0);
    const chapter2 = await insertNode(workspaceId, bookA.id, 'chapter', 'chapter-2', 1);
    const movingChapter = await insertNode(workspaceId, bookB.id, 'chapter', 'moving-chapter', 0);

    await reorderNode(sql, { nodeId: movingChapter.id, newParentId: bookA.id, newIndex: 1 });

    const ordered = await positionsUnder(bookA.id);
    expect(ordered.map((r) => r.id)).toEqual([chapter1.id, movingChapter.id, chapter2.id]);
  });
});

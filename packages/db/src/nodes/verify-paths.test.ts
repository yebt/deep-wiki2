import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { moveNode } from './move';
import { verifyPaths } from './verify-paths';

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
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<Row> {
  const [row] = await sql<Row[]>`
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

describe('verifyPaths', () => {
  test('returns empty for a freshly-built, untouched tree', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    await insertNode(workspaceId, shelf.id, 'book', 'book');

    const mismatches = await verifyPaths(sql);

    expect(mismatches).toEqual([]);
  });

  test('returns empty after a reparent move (path rewrite stayed consistent)', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const bookA = await insertNode(workspaceId, shelf.id, 'book', 'book-a');
    const bookB = await insertNode(workspaceId, shelf.id, 'book', 'book-b', 1);
    const chapter = await insertNode(workspaceId, bookA.id, 'chapter', 'chapter');
    await insertNode(workspaceId, chapter.id, 'page', 'page-1');
    await insertNode(workspaceId, chapter.id, 'page', 'page-2', 1);

    await moveNode(sql, { nodeId: chapter.id, newParentId: bookB.id });

    const mismatches = await verifyPaths(sql);

    expect(mismatches).toEqual([]);
  });

  test('detects a row whose stored path disagrees with parent_id', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');

    // Corrupt the cache directly, bypassing the trigger, to prove the
    // check actually recomputes from parent_id rather than trusting path.
    // Still shape-valid (a real UUID), just naming the wrong ancestor, so
    // the CHECK constraint does not intercept the corruption itself.
    const wrongAncestorId = crypto.randomUUID();
    await sql`UPDATE nodes SET path = ${`/${wrongAncestorId}/${shelf.id}/`} WHERE id = ${shelf.id}`;

    const mismatches = await verifyPaths(sql);

    expect(mismatches.some((m) => m.id === shelf.id)).toBe(true);
  });
});

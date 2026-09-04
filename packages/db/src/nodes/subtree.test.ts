import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { queryDescendantIds } from './subtree';

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

describe('queryDescendantIds', () => {
  test('is self-inclusive and returns every node under the given ancestor', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
    const page = await insertNode(workspaceId, book.id, 'page', 'page');

    const ids = await queryDescendantIds(sql, { workspaceId, ancestorPath: shelf.path });

    expect(new Set(ids)).toEqual(new Set([shelf.id, book.id, page.id]));
  });

  test('excludeSelf omits the ancestor row itself', async () => {
    const workspaceId = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
    const book = await insertNode(workspaceId, shelf.id, 'book', 'book');

    const ids = await queryDescendantIds(sql, { workspaceId, ancestorPath: shelf.path, excludeSelf: true });

    expect(ids).toEqual([book.id]);
  });

  test('does not cross into an unrelated workspace even given the exact same ancestor path prefix', async () => {
    const workspaceA = await seedWorkspace();
    const workspaceB = await seedWorkspace();
    const rootA = await insertNode(workspaceA, null, 'workspace', 'root-a');
    const rootB = await insertNode(workspaceB, null, 'workspace', 'root-b');
    const shelfA = await insertNode(workspaceA, rootA.id, 'shelf', 'shelf-a');
    await insertNode(workspaceB, rootB.id, 'shelf', 'shelf-b');

    const ids = await queryDescendantIds(sql, { workspaceId: workspaceA, ancestorPath: rootA.path });

    expect([...ids].sort()).toEqual([rootA.id, shelfA.id].sort());
  });

  test('a populated multi-workspace tree uses the text_pattern_ops index, not a sequential scan', async () => {
    // 2400+ rows across 40 workspaces: enough for a real cost trade-off.
    // Breadth, not depth: the 256-char path bound caps real depth at ~6
    // levels, so volume for this lighter sanity check comes from many
    // sibling books across many workspaces instead. Phase 7's dedicated
    // EXPLAIN proof re-confirms this under a much larger (~20k/60k row)
    // fixture with enable_seqscan explicitly left on.
    let targetWorkspaceId = '';
    let targetShelfPath = '';
    let targetShelfId = '';

    for (let w = 0; w < 40; w++) {
      const workspaceId = await seedWorkspace();
      const root = await insertNode(workspaceId, null, 'workspace', 'root');
      const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
      // Bulk INSERT ... SELECT (one round trip per workspace) instead of
      // 60 individually awaited inserts — the trigger still fires once
      // per resulting row either way.
      await sql`
        INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
        SELECT ${workspaceId}, ${shelf.id}, 'book'::node_type, '', gs, 'book-' || gs, 'book-' || gs
          FROM generate_series(0, 59) AS gs
      `;
      if (w === 0) {
        targetWorkspaceId = workspaceId;
        targetShelfPath = shelf.path;
        targetShelfId = shelf.id;
      }
    }

    await sql`ANALYZE nodes`;

    const [plan] = await sql<{ 'QUERY PLAN': unknown }[]>`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM nodes WHERE workspace_id = ${targetWorkspaceId} AND path LIKE ${`${targetShelfPath}%`}
    `;

    const planText = JSON.stringify(plan!['QUERY PLAN']);
    expect(planText).not.toContain('Seq Scan');
    expect(planText).toContain('nodes_ws_path_idx');
    void targetShelfId;
  }, 30_000);
});

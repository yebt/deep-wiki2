import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from './save-page';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 1 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function seedWorkspace() {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  return { workspaceId: workspace!.id as string, rootId: root!.id as string };
}

async function seedPageNode() {
  const { workspaceId, rootId } = await seedWorkspace();
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return { workspaceId, nodeId: page!.id as string };
}

// versioning-and-collaboration page-content spec: "Page Blocks Record
// Split Provenance". Reuses the split fixture already proven in
// match-blocks.test.ts's "matchBlocks: split" — one anchored block whose
// text splits into two paragraphs, the second of which shares no anchor
// with any prior block and must mint a fresh id recording its origin.
describe('reconcileDerived — split provenance', () => {
  test('a split fragment records the id of the block it split from', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const first = await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'Apples and oranges are tasty fruits, and bananas are also delicious. ^abc123\n',
      expectedContentHash: null,
    });

    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'Apples and oranges are tasty fruits.\n\nBananas are also delicious.\n',
      expectedContentHash: first.contentHash,
    });

    const rows = await sql<{ block_id: string; split_from: string | null }[]>`
      SELECT block_id, split_from FROM page_blocks
       WHERE page_id = ${nodeId} AND workspace_id = ${workspaceId} AND status = 'active'
       ORDER BY block_id
    `;
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const original = rows.find((row) => row.block_id === 'abc123');
    expect(original).toBeTruthy();
    expect(original!.split_from).toBeNull();

    const minted = rows.find((row) => row.block_id !== 'abc123');
    expect(minted).toBeTruthy();
    expect(minted!.split_from).toBe('abc123');
  });
});

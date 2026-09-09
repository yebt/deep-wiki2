import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { ChainCompressionError } from './rebuild-derived';
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

// versioning-and-collaboration page-content spec: "The Superseded Chain Is
// Walkable And Path-Compressed". These seed page_blocks rows directly
// (bypassing matchBlocks) so the chain shape is fully controlled: a chain
// of length one would exercise no compression at all, so every fixture
// here is at least three hops deep, and one is a genuine cycle.
describe('reconcileDerived — chain compression', () => {
  async function seedPageWithBlocks(): Promise<{ workspaceId: string; nodeId: string }> {
    const { workspaceId, nodeId } = await seedPageNode();
    await savePage(sql, { nodeId, workspaceId, markdown: 'A page with no anchors at all.\n', expectedContentHash: null });
    return { workspaceId, nodeId };
  }

  async function insertBlock(
    nodeId: string,
    workspaceId: string,
    blockId: string,
    status: 'active' | 'superseded' | 'tombstoned',
    supersededBy: string | null,
  ): Promise<void> {
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, superseded_by, content_hash, excerpt)
      VALUES (${nodeId}, ${workspaceId}, ${blockId}, ${status}, ${supersededBy}, 'hash', 'excerpt')
    `;
  }

  test('a five-hop merge chain resolves and compresses to the terminal survivor in one call', async () => {
    const { workspaceId, nodeId } = await seedPageWithBlocks();
    // Inserted target-first: the composite (page_id, superseded_by) FK
    // requires the referenced row to already exist.
    await insertBlock(nodeId, workspaceId, 'block-5', 'active', null);
    await insertBlock(nodeId, workspaceId, 'block-4', 'superseded', 'block-5');
    await insertBlock(nodeId, workspaceId, 'block-3', 'superseded', 'block-4');
    await insertBlock(nodeId, workspaceId, 'block-2', 'superseded', 'block-3');
    await insertBlock(nodeId, workspaceId, 'block-1', 'superseded', 'block-2');

    // Re-saving with no page_blocks-relevant edit still runs reconcileDerived,
    // and therefore compressChains, at the end of the transaction.
    const [row] = await sql<{ content_hash: string }[]>`SELECT content_hash FROM page_content WHERE node_id = ${nodeId}`;
    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'A page with no anchors at all.\n',
      expectedContentHash: row!.content_hash,
    });

    const rows = await sql<{ block_id: string; superseded_by: string | null }[]>`
      SELECT block_id, superseded_by FROM page_blocks
       WHERE page_id = ${nodeId} AND block_id IN ('block-1', 'block-2', 'block-3', 'block-4')
       ORDER BY block_id
    `;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.superseded_by).toBe('block-5');
    }
  });

  test('a cyclic superseded_by chain fails loudly rather than looping or silently doing nothing', async () => {
    const { workspaceId, nodeId } = await seedPageWithBlocks();
    // Built in two steps because a genuine cycle cannot satisfy the
    // composite FK on first insert: seed cycle-a with no target, chain
    // cycle-b and cycle-c onto already-existing rows, then close the loop
    // with an UPDATE once cycle-c exists.
    await insertBlock(nodeId, workspaceId, 'cycle-a', 'superseded', null);
    await insertBlock(nodeId, workspaceId, 'cycle-b', 'superseded', 'cycle-a');
    await insertBlock(nodeId, workspaceId, 'cycle-c', 'superseded', 'cycle-b');
    await sql`UPDATE page_blocks SET superseded_by = 'cycle-c' WHERE page_id = ${nodeId} AND block_id = 'cycle-a'`;

    const [row] = await sql<{ content_hash: string }[]>`SELECT content_hash FROM page_content WHERE node_id = ${nodeId}`;
    await expect(
      savePage(sql, {
        nodeId,
        workspaceId,
        markdown: 'A page with no anchors at all.\n',
        expectedContentHash: row!.content_hash,
      }),
    ).rejects.toThrow(ChainCompressionError);
  });

  test('a chain deeper than the 64-hop guard fails loudly rather than truncating silently', async () => {
    const { workspaceId, nodeId } = await seedPageWithBlocks();
    const HOP_COUNT = 70;
    // Inserted target-first (highest index down to 0) for the same FK
    // reason as the five-hop fixture above.
    await insertBlock(nodeId, workspaceId, `deep-${HOP_COUNT}`, 'active', null);
    for (let i = HOP_COUNT - 1; i >= 0; i--) {
      await insertBlock(nodeId, workspaceId, `deep-${i}`, 'superseded', `deep-${i + 1}`);
    }

    const [row] = await sql<{ content_hash: string }[]>`SELECT content_hash FROM page_content WHERE node_id = ${nodeId}`;
    await expect(
      savePage(sql, {
        nodeId,
        workspaceId,
        markdown: 'A page with no anchors at all.\n',
        expectedContentHash: row!.content_hash,
      }),
    ).rejects.toThrow(ChainCompressionError);
  });
});


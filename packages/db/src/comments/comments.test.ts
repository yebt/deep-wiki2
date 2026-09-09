import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from '../content/save-page';

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

async function seedWorkspace(): Promise<{ workspaceId: string; rootId: string }> {
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

async function seedPage(workspaceId: string, rootId: string): Promise<string> {
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return page!.id as string;
}

// comment-threads spec is silent on schema shape by name, but the design
// asks for a `(page_id, block_id)` FK — a cross-tenant reference must be
// unrepresentable, not merely unqueried, matching every other tenant table.
describe('comments — tenant isolation', () => {
  test('a comment naming a block from a different page is rejected by the composite FK', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageA = await seedPage(workspaceId, rootId);
    const pageB = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageA, workspaceId, markdown: 'Paragraph one. ^blocka\n', expectedContentHash: null });
    await savePage(sql, { nodeId: pageB, workspaceId, markdown: 'Paragraph two. ^blockb\n', expectedContentHash: null });

    await expect(
      (async () => {
        await sql`
          INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
          VALUES (${workspaceId}, ${pageA}, 'hi', 'blockb', 0, 5, 'Parag', 'hash', 'anchored')
        `;
      })(),
    ).rejects.toThrow(/comments_block_fk/);
  });

  test('a same-page comment insert succeeds', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageA = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageA, workspaceId, markdown: 'Paragraph one. ^blocka\n', expectedContentHash: null });

    const rows = await sql`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${workspaceId}, ${pageA}, 'hi', 'blocka', 0, 5, 'Parag', 'hash', 'anchored')
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });

  test('a reply must carry no anchor columns of its own (CHECK constraint)', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageA = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageA, workspaceId, markdown: 'Paragraph one. ^blocka\n', expectedContentHash: null });
    const [root] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${workspaceId}, ${pageA}, 'hi', 'blocka', 0, 5, 'Parag', 'hash', 'anchored')
      RETURNING id
    `;

    await expect(
      (async () => {
        await sql`
          INSERT INTO comments (workspace_id, page_id, parent_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
          VALUES (${workspaceId}, ${pageA}, ${root!.id}, 'reply', 'blocka', 0, 5, 'Parag', 'hash', 'anchored')
        `;
      })(),
    ).rejects.toThrow(/comments_root_has_anchor/);
  });

  test('a reply with no anchor columns succeeds', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageA = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageA, workspaceId, markdown: 'Paragraph one. ^blocka\n', expectedContentHash: null });
    const [root] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${workspaceId}, ${pageA}, 'hi', 'blocka', 0, 5, 'Parag', 'hash', 'anchored')
      RETURNING id
    `;

    const rows = await sql`
      INSERT INTO comments (workspace_id, page_id, parent_id, body)
      VALUES (${workspaceId}, ${pageA}, ${root!.id}, 'reply')
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });
});

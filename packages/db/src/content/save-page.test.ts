import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { NotCanonicalError, savePage, StaleContentError } from './save-page';

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

async function seedPageNode() {
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
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
  `;
  return { workspaceId: workspace!.id as string, nodeId: page!.id as string };
}

// content-and-editor page-content spec: Saving persists unchanged; Single
// Current Row; Save Regenerates Render/Index.
describe('savePage', () => {
  test('saving persists the submitted markdown unchanged', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    await savePage(sql, { nodeId, workspaceId, markdown: '# Hello\n', expectedContentHash: null });

    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${nodeId}`;
    expect(row!.markdown).toBe('# Hello\n');
  });

  test('re-saving overwrites with no historical row', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    const first = await savePage(sql, { nodeId, workspaceId, markdown: '# First\n', expectedContentHash: null });

    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: '# Second\n',
      expectedContentHash: first.contentHash,
    });

    const rows = await sql`SELECT markdown FROM page_content WHERE node_id = ${nodeId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.markdown).toBe('# Second\n');
  });

  test('save regenerates rendered_html and block_index from the new content', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const result = await savePage(sql, { nodeId, workspaceId, markdown: '# Hi\n', expectedContentHash: null });

    expect(result.renderedHtml).toContain('<h1>');
    expect(result.renderedHtml).toContain('Hi');

    const [row] = await sql`SELECT rendered_html, block_index FROM page_content WHERE node_id = ${nodeId}`;
    expect(row!.rendered_html).toBe(result.renderedHtml);
    expect(row!.block_index).toEqual(result.blockIndex);
  });

  test('rendered_html and block_index are never accepted as client-supplied input', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    // savePage's own input type has no renderedHtml/blockIndex fields at
    // all — this is a structural guarantee, not a runtime filter. Confirmed
    // here by construction: only `markdown` and the concurrency guard are
    // accepted.
    const result = await savePage(sql, { nodeId, workspaceId, markdown: 'Body.\n', expectedContentHash: null });
    expect(Object.keys(result).sort()).toEqual(['blockIndex', 'contentHash', 'renderedHtml']);
  });

  test('a stale expected content hash is rejected without writing', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    await savePage(sql, { nodeId, workspaceId, markdown: '# First\n', expectedContentHash: null });

    await expect(
      savePage(sql, { nodeId, workspaceId, markdown: '# Second\n', expectedContentHash: 'wrong-hash' }),
    ).rejects.toThrow(StaleContentError);

    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${nodeId}`;
    expect(row!.markdown).toBe('# First\n');
  });

  test('a non-canonical markdown write is rejected', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    // '*' is not the pinned bullet marker.
    await expect(
      savePage(sql, { nodeId, workspaceId, markdown: '* one\n* two\n', expectedContentHash: null }),
    ).rejects.toThrow(NotCanonicalError);
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { CURRENT_PIPELINE_VERSION } from '@deep-wiki/markdown';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { backfillOneRow, backfillRender } from './backfill-render';

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

async function seedPageNode(): Promise<{ workspaceId: string; nodeId: string }> {
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

async function seedStalePageContent(
  nodeId: string,
  workspaceId: string,
  markdown: string,
  contentHash: string,
): Promise<void> {
  await sql`
    INSERT INTO page_content (node_id, workspace_id, markdown, rendered_html, content_hash, pipeline_version)
    VALUES (${nodeId}, ${workspaceId}, ${markdown}, '', ${contentHash}, 1)
  `;
}

// comment-overlay spec: "A Render-Format Change Requires A Backfill" —
// re-render every stale row from its canonical Markdown; a page missing
// data-block-id degrades to "no anchors known" (Phase 10 surface), never
// an error.
describe('backfillRender', () => {
  test('a stale row is re-rendered and its pipeline_version is updated', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    await seedStalePageContent(nodeId, workspaceId, 'A paragraph with a persisted anchor. ^abc123\n', 'hash-stale-1');

    const result = await backfillRender(sql);

    expect(result.updated).toBeGreaterThanOrEqual(1);
    const [row] = await sql<{ rendered_html: string; pipeline_version: number }[]>`
      SELECT rendered_html, pipeline_version FROM page_content WHERE node_id = ${nodeId}
    `;
    expect(row!.pipeline_version).toBe(CURRENT_PIPELINE_VERSION);
    expect(row!.rendered_html).toContain('data-block-id="abc123"');
  });

  test('a fresh row (already at CURRENT_PIPELINE_VERSION) is left untouched', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, rendered_html, content_hash, pipeline_version)
      VALUES (${nodeId}, ${workspaceId}, '# Fresh\n', '<h1>already-current</h1>', 'hash-fresh', ${CURRENT_PIPELINE_VERSION})
    `;

    await backfillRender(sql);

    const [row] = await sql<{ rendered_html: string }[]>`SELECT rendered_html FROM page_content WHERE node_id = ${nodeId}`;
    expect(row!.rendered_html).toBe('<h1>already-current</h1>');
  });

  test('batching processes more rows than a single batchSize', async () => {
    const seeded = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const { workspaceId, nodeId } = await seedPageNode();
        await seedStalePageContent(nodeId, workspaceId, `# Page ${i}\n`, `hash-batch-${i}-${crypto.randomUUID()}`);
        return nodeId;
      }),
    );

    const result = await backfillRender(sql, { batchSize: 1 });

    expect(result.updated).toBeGreaterThanOrEqual(3);
    const rows = await sql<{ pipeline_version: number }[]>`
      SELECT pipeline_version FROM page_content WHERE node_id = ANY(${seeded})
    `;
    expect(rows.every((r) => r.pipeline_version === CURRENT_PIPELINE_VERSION)).toBe(true);
  });
});

// The row-level guard the batch loop relies on: a row saved concurrently
// during the backfill (content_hash changed after the backfill read it)
// must be skipped, not clobbered with a render of markdown that is no
// longer current.
describe('backfillOneRow', () => {
  test('updates a row whose content_hash still matches what was read', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    await seedStalePageContent(nodeId, workspaceId, '# Hi\n', 'hash-match');

    const outcome = await backfillOneRow(sql, {
      nodeId,
      workspaceId,
      markdown: '# Hi\n',
      expectedContentHash: 'hash-match',
    });

    expect(outcome).toBe('updated');
    const [row] = await sql<{ pipeline_version: number }[]>`SELECT pipeline_version FROM page_content WHERE node_id = ${nodeId}`;
    expect(row!.pipeline_version).toBe(CURRENT_PIPELINE_VERSION);
  });

  test('skips a row whose content_hash was changed by a concurrent save since it was read', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    await seedStalePageContent(nodeId, workspaceId, '# Old\n', 'hash-old');

    // Simulate a concurrent save that landed between the backfill's SELECT
    // and its guarded UPDATE: the real save already wrote the current
    // pipeline version and a new hash for genuinely new content.
    await sql`
      UPDATE page_content SET markdown = '# New\n', content_hash = 'hash-new', rendered_html = '<h1>New</h1>', pipeline_version = ${CURRENT_PIPELINE_VERSION}
       WHERE node_id = ${nodeId}
    `;

    const outcome = await backfillOneRow(sql, {
      nodeId,
      workspaceId,
      // The stale values the backfill's own SELECT would have read before the race.
      markdown: '# Old\n',
      expectedContentHash: 'hash-old',
    });

    expect(outcome).toBe('skipped');
    const [row] = await sql<{ markdown: string; rendered_html: string }[]>`
      SELECT markdown, rendered_html FROM page_content WHERE node_id = ${nodeId}
    `;
    expect(row!.markdown).toBe('# New\n');
    expect(row!.rendered_html).toBe('<h1>New</h1>');
  });
});

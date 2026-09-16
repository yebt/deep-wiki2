import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, TEST_CHANGESET_WINDOW_MINUTES, type ProvisionedTestDatabase } from '../../testing/provision';
import { CURRENT_PIPELINE_VERSION } from '@deep-wiki/markdown';
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

async function seedPage(workspaceId: string, rootId: string, title = `Page ${crypto.randomUUID()}`): Promise<string> {
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, ${title}) RETURNING id
  `;
  return page!.id as string;
}

async function seedPageNode() {
  const { workspaceId, rootId } = await seedWorkspace();
  const nodeId = await seedPage(workspaceId, rootId);
  return { workspaceId, nodeId };
}

// content-and-editor page-content spec: Saving persists unchanged; Single
// Current Row; Save Regenerates Render/Index.
describe('savePage', () => {
  test('saving persists the submitted markdown unchanged', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    await savePage(sql, { nodeId, workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${nodeId}`;
    expect(row!.markdown).toBe('# Hello\n');
  });

  test('re-saving overwrites with no historical row', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    const first = await savePage(sql, { nodeId, workspaceId, markdown: '# First\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: '# Second\n',
      expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });

    const rows = await sql`SELECT markdown FROM page_content WHERE node_id = ${nodeId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.markdown).toBe('# Second\n');
  });

  test('save regenerates rendered_html and block_index from the new content', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const result = await savePage(sql, { nodeId, workspaceId, markdown: '# Hi\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    expect(result.renderedHtml).toMatch(/<h1[ >]/);
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
    const result = await savePage(sql, { nodeId, workspaceId, markdown: 'Body.\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    expect(Object.keys(result).sort()).toEqual(['blockIndex', 'contentHash', 'renderedHtml']);
  });

  test('a stale expected content hash is rejected without writing', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    await savePage(sql, { nodeId, workspaceId, markdown: '# First\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    await expect(
      savePage(sql, { nodeId, workspaceId, markdown: '# Second\n', expectedContentHash: 'wrong-hash', changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES, }),
    ).rejects.toThrow(StaleContentError);

    const [row] = await sql`SELECT markdown FROM page_content WHERE node_id = ${nodeId}`;
    expect(row!.markdown).toBe('# First\n');
  });

  test('a non-canonical markdown write is rejected', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    // '*' is not the pinned bullet marker.
    await expect(
      savePage(sql, { nodeId, workspaceId, markdown: '* one\n* two\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES, }),
    ).rejects.toThrow(NotCanonicalError);
  });
});

// versioning-and-collaboration page-content spec: "Save Regenerates The
// Cached Render And Block Index" — pipeline_version must be truthful so a
// future staleness check (Phase 6) can trust it. Before this fix, savePage
// never wrote pipeline_version at all and every row silently kept
// 0008_page_content.sql's DEFAULT 1 forever.
describe('savePage — pipeline_version', () => {
  test('an INSERT save writes the current pipeline version, not the column default', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    await savePage(sql, { nodeId, workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const [row] = await sql<{ pipeline_version: number }[]>`
      SELECT pipeline_version FROM page_content WHERE node_id = ${nodeId}
    `;
    expect(row!.pipeline_version).toBe(CURRENT_PIPELINE_VERSION);
  });

  test('an UPDATE save also writes the current pipeline version', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    const first = await savePage(sql, { nodeId, workspaceId, markdown: '# First\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: '# Second\n',
      expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });

    const [row] = await sql<{ pipeline_version: number }[]>`
      SELECT pipeline_version FROM page_content WHERE node_id = ${nodeId}
    `;
    expect(row!.pipeline_version).toBe(CURRENT_PIPELINE_VERSION);
  });
});

// knowledge-graph: Links Are Rebuilt, Not Patched, On Every Save; Wiki-Link
// To A Non-Existent Page Resolves As Unresolved.
describe('savePage — derived links', () => {
  test('save replaces the source page’s link rows with the newly parsed set, including full removal', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const nodeId = await seedPage(workspaceId, rootId, 'Source');
    const targetA = await seedPage(workspaceId, rootId, 'Target A');
    const targetB = await seedPage(workspaceId, rootId, 'Target B');

    const first = await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'See [[Target A]] and [[Target B]].\n',
      expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });

    let rows = await sql<{ target_page_id: string }[]>`
      SELECT target_page_id FROM links WHERE source_page_id = ${nodeId} ORDER BY target_page_id
    `;
    expect(rows.map((r) => r.target_page_id).sort()).toEqual([targetA, targetB].sort());

    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'Only [[Target A]] remains.\n',
      expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });

    rows = await sql`SELECT target_page_id FROM links WHERE source_page_id = ${nodeId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target_page_id).toBe(targetA);
  });

  test('an unresolved wiki-link does not fail the save and records no resolved target', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const result = await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'See [[No Such Page]].\n',
      expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });

    expect(result.contentHash).toBeTruthy();
    const [row] = await sql<{ target_page_id: string | null; target_raw: string }[]>`
      SELECT target_page_id, target_raw FROM links WHERE source_page_id = ${nodeId}
    `;
    expect(row!.target_page_id).toBeNull();
    expect(row!.target_raw).toBe('No Such Page');
  });
});

// knowledge-graph: Tags And Page-Tag Associations Are Rebuilt On Save.
describe('savePage — derived tags', () => {
  test('a new tag is created on save and the page is linked to it', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    await savePage(sql, { nodeId, workspaceId, markdown: 'Body #project text.\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const [tag] = await sql<{ id: string }[]>`SELECT id FROM tags WHERE workspace_id = ${workspaceId} AND name = 'project'`;
    expect(tag).toBeTruthy();
    const [pageTag] = await sql`SELECT 1 AS x FROM page_tags WHERE page_id = ${nodeId} AND tag_id = ${tag!.id}`;
    expect(pageTag).toBeTruthy();
  });

  test('a removed tag drops its page_tags association', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    const first = await savePage(sql, { nodeId, workspaceId, markdown: 'Body #project text.\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    await savePage(sql, { nodeId, workspaceId, markdown: 'Body without the tag.\n', expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const rows = await sql`SELECT 1 AS x FROM page_tags WHERE page_id = ${nodeId}`;
    expect(rows).toHaveLength(0);
  });
});

// design.md "Block identity" / "The save transaction" — the reconciliation
// wiring itself; matchBlocks' own threshold algorithm is unit-tested in
// match-blocks.test.ts (WU-3) and is not re-derived here.
describe('savePage — block reconciliation', () => {
  test('an anchored block registers active on first save and tombstones once its content is fully replaced', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const first = await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'This is the tracked paragraph with enough distinct words to match reliably. ^abc123\n',
      expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });

    let rows = await sql<{ status: string }[]>`SELECT status FROM page_blocks WHERE page_id = ${nodeId} AND block_id = 'abc123'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('active');

    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'Nothing here resembles that original wording whatsoever anymore.\n',
      expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });

    rows = await sql`SELECT status FROM page_blocks WHERE page_id = ${nodeId} AND block_id = 'abc123'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('tombstoned');
  });
});

// versioning-and-collaboration revision-history spec: "Revision Is Written
// In The Save Transaction" — a save must write exactly one page_revision
// row matching the newly saved content, and a failed save must write
// neither page_content nor page_revision.
describe('savePage — revisions', () => {
  test('a successful save writes exactly one new page_revision row matching the saved content', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const result = await savePage(sql, { nodeId, workspaceId, markdown: '# Hello\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const rows = await sql<{ content: string; content_hash: string }[]>`
      SELECT content, content_hash FROM page_revision WHERE page_id = ${nodeId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('# Hello\n');
    expect(rows[0]!.content_hash).toBe(result.contentHash);
  });

  test('a second save writes a second revision, leaving the first untouched', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    const first = await savePage(sql, { nodeId, workspaceId, markdown: '# First\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    await savePage(sql, { nodeId, workspaceId, markdown: '# Second\n', expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const rows = await sql<{ content: string }[]>`
      SELECT content FROM page_revision WHERE page_id = ${nodeId} ORDER BY created_at ASC
    `;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.content)).toEqual(['# First\n', '# Second\n']);
  });

  test('a failed save (stale content hash) writes neither page_content nor page_revision', async () => {
    const { workspaceId, nodeId } = await seedPageNode();
    await savePage(sql, { nodeId, workspaceId, markdown: '# First\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    await expect(
      savePage(sql, { nodeId, workspaceId, markdown: '# Second\n', expectedContentHash: 'wrong-hash', changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES, }),
    ).rejects.toThrow(StaleContentError);

    const revisionRows = await sql`SELECT 1 AS x FROM page_revision WHERE page_id = ${nodeId} AND content = '# Second\n'`;
    expect(revisionRows).toHaveLength(0);
    const contentRows = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${nodeId}`;
    expect(contentRows[0]!.markdown).toBe('# First\n');
  });
});

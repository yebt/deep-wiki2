/**
 * `e2e/comments-fixtures.bun.ts` mints the rows `e2e/comments.spec.ts`
 * drives against — a commenter, an editor, three pages and their threads
 * — into the database `e2e/global-setup.ts` already seeded. This runs the
 * same minting against a provisioned database holding the two things the
 * script looks for (a workspace with a root node, and the seeded reader),
 * and checks what the spec relies on: the pages are saved with anchored
 * blocks, the threads point at those blocks, the legacy page's cached
 * render really carries no `data-block-id`, and the seeded database is
 * found by its workspace id among this worktree's `dw_test_*` databases.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { defaultProvisionDeps, dropTestDatabase, provisionTestDatabase, resolveAdminUrl, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { findSeededDatabase, mintCommentFixtures } from '../../../e2e/comments-fixtures.bun';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;
let workspaceId: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 3, onnotice: () => {} });
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'unused', 'Owner') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'Fixture WS', ${`fixture-${crypto.randomUUID()}`}) RETURNING id
  `;
  workspaceId = ws!.id;
  await sql`INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title) VALUES (${workspaceId}, NULL, 'workspace', '', 0, 'root', 'Root')`;
  await sql`INSERT INTO users (email, password_hash, display_name) VALUES (${`reader-${crypto.randomUUID()}@example.com`}, 'unused', 'E2E Reader')`;
});

afterAll(async () => {
  await sql?.end({ timeout: 1 }).catch(() => {});
  if (db) await dropTestDatabase(await resolveAdminUrl(defaultProvisionDeps), db.name);
});

describe('e2e/comments-fixtures.bun.ts', () => {
  test('mints anchored pages whose threads point at real blocks, and a legacy render with no anchors at all', async () => {
    const fixtures = await mintCommentFixtures(sql, workspaceId);

    const [commented] = await sql<{ rendered_html: string }[]>`SELECT rendered_html FROM page_content WHERE node_id = ${fixtures.commentsPageId}`;
    expect(commented!.rendered_html).toContain('data-block-id="E2ECMTTWO"');
    const threads = await sql<{ block_id: string | null; quote: string | null; parent_id: string | null }[]>`
      SELECT block_id, quote, parent_id FROM comments WHERE page_id = ${fixtures.commentsPageId} ORDER BY created_at
    `;
    expect(threads.map((row) => ({ blockId: row.block_id, quote: row.quote, isRoot: row.parent_id === null }))).toEqual([
      { blockId: 'E2ECMTTWO', quote: fixtures.commentedQuote, isRoot: true },
      { blockId: null, quote: null, isRoot: false },
    ]);

    const [legacy] = await sql<{ rendered_html: string; pipeline_version: number }[]>`
      SELECT rendered_html, pipeline_version FROM page_content WHERE node_id = ${fixtures.legacyPageId}
    `;
    expect(legacy!.rendered_html).not.toContain('data-block-id');
    expect(legacy!.rendered_html).toContain(fixtures.legacyQuote);
    expect(legacy!.pipeline_version).toBe(1);
    const [legacyThread] = await sql<{ block_id: string }[]>`SELECT block_id FROM comments WHERE page_id = ${fixtures.legacyPageId}`;
    expect(legacyThread!.block_id).toBe('E2ELEGACY1');

    // The escaped-space page is the regression fixture, and its point is that
    // the bytes are canonical and unanchored: a page already carrying an
    // anchor, or one `savePage()` had normalised on the way in, would never
    // drive the mint's own splice (docs/TODO.md, 2026-09-23).
    const [escapedSpace] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixtures.escapedSpacePageId}`;
    expect(escapedSpace!.markdown).toBe('This is a content @Seed Owner&#x20;\n');
    expect(escapedSpace!.markdown).not.toContain('^');
    expect(fixtures.escapedSpaceParagraph).toBe('This is a content @Seed Owner');
  }, 30_000);

  test('finds the database that holds the workspace among this worktree’s test databases', async () => {
    const url = await findSeededDatabase(workspaceId);

    expect(url).toEndWith(`/${db.name}`);
    await expect(findSeededDatabase(crypto.randomUUID())).rejects.toThrow(/no dw_test_\* database holds workspace/);
  }, 30_000);
});

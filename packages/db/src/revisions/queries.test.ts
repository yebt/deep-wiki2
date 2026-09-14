/**
 * The revision read path (revision-history spec: "Page History Query
 * Returns Revisions Newest First"; block-diff spec's `getRevisionsByIds`
 * consumer). Both read only `page_revision.content`/metadata — never
 * `block_index`, which `diffBlocks()` must not depend on (block-diff spec:
 * "The Diff Re-Parses Both Sides Fresh").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, TEST_CHANGESET_WINDOW_MINUTES, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from '../content/save-page';
import { getRevisionsByIds, listPageRevisions } from './queries';

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

async function seedPage(): Promise<{ workspaceId: string; pageId: string; authorId: string }> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
  `;
  return { workspaceId: ws!.id, pageId: page!.id, authorId: owner!.id };
}

describe('listPageRevisions', () => {
  test('returns a page\'s revisions newest first', async () => {
    const { workspaceId, pageId, authorId } = await seedPage();
    const first = await savePage(sql, { nodeId: pageId, workspaceId, markdown: '# One\n', expectedContentHash: null, updatedBy: authorId, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const second = await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# Two\n',
      expectedContentHash: first.contentHash,
      updatedBy: authorId, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });
    void second;

    const revisions = await listPageRevisions(sql, { pageId, workspaceId });

    expect(revisions).toHaveLength(2);
    // Newest first: the second save's snapshot precedes the first's.
    const contents = await getRevisionsByIds(sql, { workspaceId, ids: revisions.map((r) => r.id) });
    const byId = new Map(contents.map((c) => [c.id, c.content]));
    expect(byId.get(revisions[0]!.id)).toContain('Two');
    expect(byId.get(revisions[1]!.id)).toContain('One');
  });

  test('a page with no saves has no revisions', async () => {
    const { workspaceId, pageId } = await seedPage();

    const revisions = await listPageRevisions(sql, { pageId, workspaceId });

    expect(revisions).toHaveLength(0);
  });

  test('carries the author\'s display name, not just their id, for the history screen to render "who"', async () => {
    const { workspaceId, pageId, authorId } = await seedPage();
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: '# One\n', expectedContentHash: null, updatedBy: authorId, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const [revision] = await listPageRevisions(sql, { pageId, workspaceId });

    expect(revision?.authorId).toBe(authorId);
    expect(revision?.authorDisplayName).toBe('Owner');
  });

  test('a save with no author has a null display name, not a crash or an empty-string join artefact', async () => {
    const { workspaceId, pageId } = await seedPage();
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: '# One\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const [revision] = await listPageRevisions(sql, { pageId, workspaceId });

    expect(revision?.authorId).toBeNull();
    expect(revision?.authorDisplayName).toBeNull();
  });
});

describe('getRevisionsByIds', () => {
  test('returns each requested revision\'s own content, not the other side\'s', async () => {
    const { workspaceId, pageId, authorId } = await seedPage();
    const first = await savePage(sql, { nodeId: pageId, workspaceId, markdown: '# First content\n', expectedContentHash: null, updatedBy: authorId, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# Second content\n',
      expectedContentHash: first.contentHash,
      updatedBy: authorId, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });
    const revisions = await listPageRevisions(sql, { pageId, workspaceId });
    const [newest, oldest] = revisions;

    const rows = await getRevisionsByIds(sql, { workspaceId, ids: [newest!.id, oldest!.id] });

    expect(rows).toHaveLength(2);
    const newestRow = rows.find((r) => r.id === newest!.id);
    const oldestRow = rows.find((r) => r.id === oldest!.id);
    expect(newestRow?.content).toContain('Second content');
    expect(oldestRow?.content).toContain('First content');
  });

  test('an empty id list returns an empty array without querying', async () => {
    const { workspaceId } = await seedPage();

    const rows = await getRevisionsByIds(sql, { workspaceId, ids: [] });

    expect(rows).toEqual([]);
  });
});

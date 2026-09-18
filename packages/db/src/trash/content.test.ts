/**
 * `readTrashedPageHtml()` — page-content spec delta: "A manager can still
 * read a trashed page's content". Unlike `readPageHtml()` (`live_page_content`),
 * this reads the base `page_content` table directly, so it must be proven
 * against the base table's real behaviour rather than mocked.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { readTrashedPageHtml } from './content';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function seedTrashedPageWithContent(): Promise<{ workspaceId: string; nodeId: string }> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace'::node_type, '', 0, 'root', 'root')
    RETURNING id
  `;
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title, trashed_at, trash_operation_id, trashed_by)
    VALUES (${workspace!.id}, ${root!.id}, 'page'::node_type, '', 0, 'overview', 'Overview', now(), ${crypto.randomUUID()}, ${owner!.id})
    RETURNING id
  `;
  await sql`
    INSERT INTO page_content (node_id, workspace_id, markdown, rendered_html, content_hash)
    VALUES (${page!.id}, ${workspace!.id}, '# Overview\n', '<h1>Overview</h1>', 'hash-1')
  `;
  return { workspaceId: workspace!.id, nodeId: page!.id };
}

describe('readTrashedPageHtml', () => {
  test('returns the trashed page content, unchanged', async () => {
    const { workspaceId, nodeId } = await seedTrashedPageWithContent();

    const result = await readTrashedPageHtml(sql, { nodeId, workspaceId });

    expect(result).toEqual({ renderedHtml: '<h1>Overview</h1>' });
  });

  test('returns undefined for a page with no stored content', async () => {
    const [owner] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
    `;
    const [workspace] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
    `;
    const [root] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspace!.id}, NULL, 'workspace'::node_type, '', 0, 'root', 'root')
      RETURNING id
    `;
    const [page] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title, trashed_at, trash_operation_id, trashed_by)
      VALUES (${workspace!.id}, ${root!.id}, 'page'::node_type, '', 0, 'blank', 'Blank', now(), ${crypto.randomUUID()}, ${owner!.id})
      RETURNING id
    `;

    expect(await readTrashedPageHtml(sql, { nodeId: page!.id, workspaceId: workspace!.id })).toBeUndefined();
  });
});

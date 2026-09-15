/**
 * `e2e/editor-fixtures.bun.ts` mints the row `e2e/editor.spec.ts`'s
 * real-backend test drives against — a writer and one already-saved page —
 * into the database `e2e/global-setup.ts` already seeded. This runs the
 * same minting against a provisioned database holding the one thing the
 * script looks for (a workspace with a root node), and checks what the
 * spec relies on: the page is really saved with the fixture's markdown,
 * and the writer really holds `write` on it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { defaultProvisionDeps, dropTestDatabase, provisionTestDatabase, resolveAdminUrl, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { mintEditorFixtures } from '../../../e2e/editor-fixtures.bun';

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
});

afterAll(async () => {
  await sql?.end({ timeout: 1 }).catch(() => {});
  if (db) await dropTestDatabase(await resolveAdminUrl(defaultProvisionDeps), db.name);
});

describe('e2e/editor-fixtures.bun.ts', () => {
  test('mints a writer who really holds write on a page that is really saved with the fixture markdown', async () => {
    const fixtures = await mintEditorFixtures(sql, workspaceId);

    const [content] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixtures.editablePageId}`;
    expect(content!.markdown).toBe(fixtures.editablePageMarkdown);

    const [grant] = await sql<{ subject_id: string }[]>`
      SELECT subject_id FROM permissions WHERE resource_id = ${fixtures.editablePageId} AND action = 'write' AND effect = 'allow'
    `;
    expect(grant).toBeTruthy();

    const [session] = await sql<{ user_id: string }[]>`SELECT user_id FROM sessions WHERE user_id = ${grant!.subject_id}`;
    expect(session).toBeTruthy();
  }, 30_000);
});

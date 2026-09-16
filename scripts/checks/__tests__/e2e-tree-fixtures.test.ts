/**
 * `e2e/tree-fixtures.bun.ts` mints what `e2e/tree-writes.spec.ts` drives
 * against — a writer and a shelf › book › two pages they may reorder —
 * into the database `e2e/global-setup.ts` already seeded. This runs the
 * same minting against a provisioned database holding the one thing the
 * script looks for (a workspace with a root node), and checks what the
 * spec relies on: the two pages are siblings under the book in the seeded
 * order, and the writer really holds `write` on the book and both pages.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { defaultProvisionDeps, dropTestDatabase, provisionTestDatabase, resolveAdminUrl, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { mintTreeFixtures } from '../../../e2e/tree-fixtures.bun';

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

describe('e2e/tree-fixtures.bun.ts', () => {
  test('mints two sibling pages under a book, in order, and a writer who holds write on all three', async () => {
    const fixtures = await mintTreeFixtures(sql, workspaceId);

    const pages = await sql<{ id: string; position: number }[]>`
      SELECT id, position FROM nodes WHERE parent_id = ${fixtures.bookId} ORDER BY position ASC
    `;
    expect(pages.map((page) => page.id)).toEqual([fixtures.firstPageId, fixtures.secondPageId]);

    const grants = await sql<{ resource_id: string }[]>`
      SELECT resource_id FROM permissions WHERE action = 'write' AND effect = 'allow'
        AND resource_id IN (${fixtures.bookId}, ${fixtures.firstPageId}, ${fixtures.secondPageId})
    `;
    expect(new Set(grants.map((grant) => grant.resource_id))).toEqual(new Set([fixtures.bookId, fixtures.firstPageId, fixtures.secondPageId]));

    // The session belongs to the user the grants name — the token the spec sends is the writer's.
    const [grantee] = await sql<{ subject_id: string }[]>`SELECT subject_id FROM permissions WHERE resource_id = ${fixtures.bookId} AND action = 'write'`;
    const [session] = await sql<{ user_id: string }[]>`SELECT user_id FROM sessions WHERE user_id = ${grantee!.subject_id}`;
    expect(session).toBeTruthy();
  }, 30_000);
});

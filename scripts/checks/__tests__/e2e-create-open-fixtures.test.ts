/**
 * `e2e/create-open-fixtures.bun.ts` mints what `e2e/create-and-open.spec.ts`
 * drives against, and its whole point is what it does *not* mint: the spec
 * builds every node it touches through the UI, because a seeded page is a
 * page the tree did not create — and a fixture that saved content is
 * precisely how the never-saved read path went untested until 2026-09-23
 * (docs/TODO.md Findings, 2026-09-23).
 *
 * So both halves are asserted here: the builder really holds `read`,
 * `write` and `manage` on the workspace **root** (creating a shelf needs
 * `write` on the parent, and the parent of a shelf is the root), and the
 * script adds no node, no content row and no revision of its own.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { defaultProvisionDeps, dropTestDatabase, provisionTestDatabase, resolveAdminUrl, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { mintCreateOpenFixtures } from '../../../e2e/create-open-fixtures.bun';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;
let workspaceId: string;
let rootId: string;

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
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  rootId = root!.id;
});

afterAll(async () => {
  await sql?.end({ timeout: 1 }).catch(() => {});
  if (db) await dropTestDatabase(await resolveAdminUrl(defaultProvisionDeps), db.name);
});

describe('e2e/create-open-fixtures.bun.ts', () => {
  test('mints a member holding read, write and manage on the workspace root, with a session', async () => {
    const fixtures = await mintCreateOpenFixtures(sql, workspaceId);

    const grants = await sql<{ subject_id: string; action: string }[]>`
      SELECT subject_id, action FROM permissions
       WHERE resource_id = ${rootId} AND effect = 'allow' AND workspace_id = ${workspaceId}
    `;
    expect(new Set(grants.map((grant) => grant.action))).toEqual(new Set(['read', 'write', 'manage']));

    const subjectIds = new Set(grants.map((grant) => grant.subject_id));
    expect(subjectIds.size).toBe(1);
    const [session] = await sql<{ user_id: string }[]>`SELECT user_id FROM sessions WHERE user_id = ${[...subjectIds][0]!}`;
    expect(session).toBeTruthy();
    expect(fixtures.builderSessionToken.length).toBeGreaterThan(0);
    expect(fixtures.run).toMatch(/^[0-9a-f]{8}$/);
  }, 30_000);

  // The spec builds shelf › book › chapter › page itself; anything this
  // script left behind would be a node the UI did not make.
  test('mints no node, no content row and no revision', async () => {
    await mintCreateOpenFixtures(sql, workspaceId);

    const nodes = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE workspace_id = ${workspaceId}`;
    expect(nodes.map((node) => node.id)).toEqual([rootId]);
    expect(await sql`SELECT node_id FROM page_content WHERE workspace_id = ${workspaceId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM page_revision WHERE workspace_id = ${workspaceId}`).toHaveLength(0);
  }, 30_000);
});

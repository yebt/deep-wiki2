/**
 * `isWorkspaceMember` (versioning-and-collaboration design.md Decision 5,
 * "Where the endpoint lives and how it is mounted" — the presence stream
 * gate). "Workspace membership" is the same predicate
 * `listWorkspaceMemberCandidates` already uses for mention candidates:
 * anyone with a recorded grant in this workspace, a cell member, or the
 * workspace owner — there is no separate membership table.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { isWorkspaceMember } from './candidates';

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

async function insertUser(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${slug}-${crypto.randomUUID()}@example.com`}, 'hash', ${slug})
    RETURNING id
  `;
  return row!.id as string;
}

async function insertWorkspace(ownerId: string, slug: string): Promise<{ workspaceId: string; rootId: string }> {
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, ${slug}, ${`${slug}-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, ${`${slug}-root`}, ${`${slug}-root`}) RETURNING id
  `;
  return { workspaceId: ws!.id, rootId: root!.id };
}

describe('isWorkspaceMember', () => {
  test('the workspace owner is a member with no recorded grant at all', async () => {
    const owner = await insertUser('owner');
    const { workspaceId } = await insertWorkspace(owner, 'ws-owner');

    const member = await isWorkspaceMember(sql, { workspaceId, userId: owner });

    expect(member).toBe(true);
  });

  test('a user with a recorded grant in the workspace is a member', async () => {
    const owner = await insertUser('owner');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws-grant');
    const grantee = await insertUser('grantee');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${workspaceId}, 'user', ${grantee}, ${rootId}, 'read', 'allow')
    `;

    const member = await isWorkspaceMember(sql, { workspaceId, userId: grantee });

    expect(member).toBe(true);
  });

  test('a user with no grant, not the owner, and not a cell member is not a member', async () => {
    const owner = await insertUser('owner');
    const { workspaceId } = await insertWorkspace(owner, 'ws-outsider');
    const outsider = await insertUser('outsider');

    const member = await isWorkspaceMember(sql, { workspaceId, userId: outsider });

    expect(member).toBe(false);
  });

  test('a grant in a different workspace does not make the user a member of this one', async () => {
    const owner = await insertUser('owner');
    const { workspaceId: workspaceA } = await insertWorkspace(owner, 'ws-a');
    const { workspaceId: workspaceB, rootId: rootB } = await insertWorkspace(owner, 'ws-b');
    const grantee = await insertUser('grantee-b');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${workspaceB}, 'user', ${grantee}, ${rootB}, 'read', 'allow')
    `;

    const member = await isWorkspaceMember(sql, { workspaceId: workspaceA, userId: grantee });

    expect(member).toBe(false);
  });
});

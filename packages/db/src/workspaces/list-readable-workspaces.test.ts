/**
 * The workspace list a signed-in caller is allowed to see. The permission
 * fold itself is `readableWorkspaceIds`' (and is tested there); what this
 * covers is that nothing outside that set is ever selected, and that the
 * rows come back in the order the screen renders them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { listReadableWorkspaces } from './list-readable-workspaces';

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
  return row!.id;
}

async function insertWorkspace(ownerId: string, name: string): Promise<{ workspaceId: string; rootId: string; slug: string }> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}`;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, ${name}, ${slug}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, ${slug}, ${name})
    RETURNING id
  `;
  return { workspaceId: ws!.id, rootId: root!.id, slug };
}

async function allowRead(workspaceId: string, userId: string, resourceId: string): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${userId}, ${resourceId}, 'read', 'allow')
  `;
}

describe('listReadableWorkspaces', () => {
  test('returns the readable workspaces by name and slug, alphabetically, and no others', async () => {
    const owner = await insertUser('owner');
    const subject = await insertUser('subject');
    const zulu = await insertWorkspace(owner, 'Zulu Handbook');
    const alpha = await insertWorkspace(owner, 'Alpha Handbook');
    const unreadable = await insertWorkspace(owner, 'Bravo Handbook');

    await allowRead(zulu.workspaceId, subject, zulu.rootId);
    await allowRead(alpha.workspaceId, subject, alpha.rootId);
    await allowRead(unreadable.workspaceId, owner, unreadable.rootId);

    const listed = await listReadableWorkspaces(sql, { subjectType: 'user', subjectId: subject });

    expect(listed).toEqual([
      { id: alpha.workspaceId, name: 'Alpha Handbook', slug: alpha.slug },
      { id: zulu.workspaceId, name: 'Zulu Handbook', slug: zulu.slug },
    ]);
  });

  test('returns an empty list, not every workspace, for a subject with no grants at all', async () => {
    const owner = await insertUser('owner-2');
    const stranger = await insertUser('stranger');
    const ws = await insertWorkspace(owner, 'Private Handbook');
    await allowRead(ws.workspaceId, owner, ws.rootId);

    const listed = await listReadableWorkspaces(sql, { subjectType: 'user', subjectId: stranger });

    expect(listed).toEqual([]);
  });
});

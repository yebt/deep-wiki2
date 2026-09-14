import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { insertGrants } from '../permissions/grants';
import { listWorkspaceMembers } from './list-members';

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

async function insertUser(displayName: string): Promise<{ id: string; email: string }> {
  const email = `${displayName.toLowerCase()}-${crypto.randomUUID()}@example.com`;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${email}, 'hash', ${displayName}) RETURNING id
  `;
  return { id: row!.id, email };
}

async function insertWorkspace(ownerId: string): Promise<{ id: string; rootId: string }> {
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  return { id: ws!.id, rootId: root!.id };
}

/**
 * The fixture holds every kind of person a membership listing can get
 * wrong: the owner (no grant row of their own), a direct grant holder, a
 * cell member with no direct grant, a user whose only grant is in a
 * *different* workspace, and a user with nothing anywhere. A listing that
 * returned "everyone with a grant somewhere" or "every user" would fail
 * here, not pass by accident.
 */
describe('listWorkspaceMembers', () => {
  test('lists the owner, direct grant holders and cell members of this workspace only, sorted by name, with email', async () => {
    const owner = await insertUser('Zed Owner');
    const direct = await insertUser('Ada Direct');
    const viaCell = await insertUser('Cy Cell');
    const elsewhere = await insertUser('Eve Elsewhere');
    const nobody = await insertUser('Nia Nobody');
    const ws = await insertWorkspace(owner.id);
    const otherWs = await insertWorkspace(elsewhere.id);

    await insertGrants(sql, ws.id, 'user', direct.id, [{ resourceId: ws.rootId, action: 'read', effect: 'allow' }]);
    await insertGrants(sql, otherWs.id, 'user', elsewhere.id, [{ resourceId: otherWs.rootId, action: 'read', effect: 'allow' }]);
    const [cell] = await sql<{ id: string }[]>`
      INSERT INTO cells (workspace_id, name) VALUES (${ws.id}, 'Platform') RETURNING id
    `;
    await sql`INSERT INTO cell_members (workspace_id, cell_id, user_id) VALUES (${ws.id}, ${cell!.id}, ${viaCell.id})`;

    const members = await listWorkspaceMembers(sql, ws.id);

    expect(members.map((m) => m.displayName)).toEqual(['Ada Direct', 'Cy Cell', 'Zed Owner']);
    expect(members.find((m) => m.id === direct.id)?.email).toBe(direct.email);
    expect(members.map((m) => m.id)).not.toContain(elsewhere.id);
    expect(members.map((m) => m.id)).not.toContain(nobody.id);
  });
});

/**
 * "Which workspaces may this subject read anything in" — the set-shaped
 * question `GET /workspaces` asks, answered here so the `permissions`
 * table stays inside this one directory
 * (scripts/checks/query-boundaries.ts rule 1).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { readableWorkspaceIds } from './readable-workspaces';

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

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug})
    RETURNING id
  `;
  return row!.id;
}

async function insertUser(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${slug}-${crypto.randomUUID()}@example.com`}, 'hash', ${slug})
    RETURNING id
  `;
  return row!.id;
}

async function insertWorkspace(ownerId: string, slug: string): Promise<{ workspaceId: string; rootId: string }> {
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, ${slug}, ${`${slug}-${crypto.randomUUID()}`}) RETURNING id
  `;
  const rootId = await insertNode(ws!.id, null, 'workspace', `${slug}-root`);
  return { workspaceId: ws!.id, rootId };
}

async function insertCell(workspaceId: string, name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO cells (workspace_id, name) VALUES (${workspaceId}, ${name}) RETURNING id
  `;
  return row!.id;
}

async function grant(
  workspaceId: string,
  subjectType: 'user' | 'cell',
  subjectId: string,
  resourceId: string,
  action: string,
  effect: 'allow' | 'deny',
): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, ${subjectType}::subject_kind, ${subjectId}, ${resourceId}, ${action}::perm_action, ${effect}::perm_effect)
  `;
}

describe('readableWorkspaceIds', () => {
  test('includes a workspace where one node is readable and excludes one where nothing is', async () => {
    const owner = await insertUser('owner');
    const subject = await insertUser('subject');
    const visible = await insertWorkspace(owner, 'visible');
    const hidden = await insertWorkspace(owner, 'hidden');

    // The grant is on a page, not on the workspace root: a member who was
    // given one book is exactly the caller who must still be able to reach
    // the workspace holding it.
    const page = await insertNode(visible.workspaceId, visible.rootId, 'page', 'granted-page');
    await grant(visible.workspaceId, 'user', subject, page, 'read', 'allow');
    // The hidden workspace has content, and a grant for somebody else.
    const otherPage = await insertNode(hidden.workspaceId, hidden.rootId, 'page', 'other-page');
    await grant(hidden.workspaceId, 'user', owner, otherPage, 'read', 'allow');

    const readable = await readableWorkspaceIds(sql, { subjectType: 'user', subjectId: subject });

    expect(readable.has(visible.workspaceId)).toBe(true);
    expect(readable.has(hidden.workspaceId)).toBe(false);
  });

  test('a grant above read (write, manage) still makes the workspace readable', async () => {
    const owner = await insertUser('owner-w');
    const subject = await insertUser('subject-w');
    const ws = await insertWorkspace(owner, 'writable');
    await grant(ws.workspaceId, 'user', subject, ws.rootId, 'manage', 'allow');

    const readable = await readableWorkspaceIds(sql, { subjectType: 'user', subjectId: subject });

    expect(readable.has(ws.workspaceId)).toBe(true);
  });

  test('a deny at the same resource beats an allow there, exactly as decide() folds one resource', async () => {
    const owner = await insertUser('owner-d');
    const subject = await insertUser('subject-d');
    const ws = await insertWorkspace(owner, 'denied');
    const page = await insertNode(ws.workspaceId, ws.rootId, 'page', 'contested');
    await grant(ws.workspaceId, 'user', subject, page, 'read', 'allow');
    await grant(ws.workspaceId, 'user', subject, page, 'read', 'deny');

    const readable = await readableWorkspaceIds(sql, { subjectType: 'user', subjectId: subject });

    expect(readable.has(ws.workspaceId)).toBe(false);
  });

  test('a deny on the only granted node does not hide a sibling the subject was separately granted', async () => {
    const owner = await insertUser('owner-m');
    const subject = await insertUser('subject-m');
    const ws = await insertWorkspace(owner, 'mixed');
    const denied = await insertNode(ws.workspaceId, ws.rootId, 'page', 'denied-page');
    const allowed = await insertNode(ws.workspaceId, ws.rootId, 'page', 'allowed-page');
    await grant(ws.workspaceId, 'user', subject, denied, 'read', 'deny');
    await grant(ws.workspaceId, 'user', subject, allowed, 'read', 'allow');

    const readable = await readableWorkspaceIds(sql, { subjectType: 'user', subjectId: subject });

    expect(readable.has(ws.workspaceId)).toBe(true);
  });

  test('a cell grant counts for a member, and a cell the subject does not belong to does not', async () => {
    const owner = await insertUser('owner-c');
    const subject = await insertUser('subject-c');
    const memberWorkspace = await insertWorkspace(owner, 'cell-member');
    const otherWorkspace = await insertWorkspace(owner, 'cell-outsider');

    const ownCell = await insertCell(memberWorkspace.workspaceId, 'Platform');
    await sql`
      INSERT INTO cell_members (cell_id, user_id, workspace_id)
      VALUES (${ownCell}, ${subject}, ${memberWorkspace.workspaceId})
    `;
    await grant(memberWorkspace.workspaceId, 'cell', ownCell, memberWorkspace.rootId, 'read', 'allow');

    // A cell in another workspace, holding the only grant there, that this
    // subject is not a member of. Both halves of the membership expansion
    // matter: the workspace-scoped join, and the membership itself.
    const foreignCell = await insertCell(otherWorkspace.workspaceId, 'Platform');
    await grant(otherWorkspace.workspaceId, 'cell', foreignCell, otherWorkspace.rootId, 'read', 'allow');

    const readable = await readableWorkspaceIds(sql, { subjectType: 'user', subjectId: subject });

    expect(readable.has(memberWorkspace.workspaceId)).toBe(true);
    expect(readable.has(otherWorkspace.workspaceId)).toBe(false);
  });
});

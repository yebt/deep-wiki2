/**
 * `trashLookup()` truth table (design.md Decision 7 / page-content spec
 * delta — "A manager can still read a trashed page's content").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { trashLookup } from './lookup';
import { trashNode } from './trash-node';

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

interface Row {
  id: string;
  path: string;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string): Promise<Row> {
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug})
    RETURNING id, path
  `;
  return row!;
}

async function seedWorkspace(): Promise<{ workspaceId: string; ownerId: string }> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  return { workspaceId: workspace!.id, ownerId: user!.id };
}

async function seedTree() {
  const { workspaceId, ownerId } = await seedWorkspace();
  const root = await insertNode(workspaceId, null, 'workspace', 'root');
  const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
  const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
  const chapter = await insertNode(workspaceId, book.id, 'chapter', 'chapter');
  const page = await insertNode(workspaceId, chapter.id, 'page', 'page');
  return { workspaceId, ownerId, root, shelf, book, chapter, page };
}

async function grantManage(workspaceId: string, resourceId: string, subjectId: string): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${subjectId}, ${resourceId}, 'manage', 'allow')
  `;
}

async function insertUser(): Promise<string> {
  const [row] = await sql<{ id: string }[]>`INSERT INTO users (email, password_hash, display_name) VALUES (${`u-${crypto.randomUUID()}@example.com`}, 'hash', 'U') RETURNING id`;
  return row!.id;
}

describe('trashLookup', () => {
  test('a live (never trashed) node is null', async () => {
    const { page, ownerId } = await seedTree();
    expect(await trashLookup(sql, { nodeId: page.id, subjectId: ownerId })).toBeNull();
  });

  test('an unknown node id is null', async () => {
    expect(await trashLookup(sql, { nodeId: crypto.randomUUID(), subjectId: crypto.randomUUID() })).toBeNull();
  });

  test('a trashed node without manage is null, identically to unknown', async () => {
    const { page, ownerId } = await seedTree();
    await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });

    const outsider = await insertUser();
    expect(await trashLookup(sql, { nodeId: page.id, subjectId: outsider })).toBeNull();
  });

  test('the manager who trashed it can look it up', async () => {
    const { workspaceId, page, ownerId } = await seedTree();
    const trashed = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(trashed.ok).toBe(true);
    await grantManage(workspaceId, page.id, ownerId);

    const result = await trashLookup(sql, { nodeId: page.id, subjectId: ownerId });
    expect(result).not.toBeNull();
    expect(result!.operationId).toBe(trashed.ok ? trashed.trashOperationId : '');
    expect(result!.trashedBy?.id).toBe(ownerId);
    expect(result!.daysLeft).toBe(30);
    expect(result!.restoreBlockedBy).toBeNull();
  });

  // apps/api/src/routes/pages.ts's GET /pages/:id wires this result
  // straight into its response after a live_nodes miss, with no second
  // base-table read of its own — it needs the node's own identity here.
  test('carries the trashed node\'s own title and workspace identity', async () => {
    const { workspaceId, page, ownerId } = await seedTree();
    await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    await grantManage(workspaceId, page.id, ownerId);

    const result = await trashLookup(sql, { nodeId: page.id, subjectId: ownerId });

    expect(result!.title).toBe('page');
    expect(result!.workspaceId).toBe(workspaceId);
    expect(result!.workspaceSlug).toEqual(expect.any(String));
  });

  test('a different manager (manage on the node, not the one who trashed it) can also look it up', async () => {
    const { workspaceId, page, ownerId } = await seedTree();
    await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    const otherManager = await insertUser();
    await grantManage(workspaceId, page.id, otherManager);

    expect(await trashLookup(sql, { nodeId: page.id, subjectId: otherManager })).not.toBeNull();
  });
});

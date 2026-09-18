/**
 * `listManageableTrash()` truth table (trash-restore spec).
 * `manageableTrashRoots()` itself already has its own dedicated truth
 * table (`packages/db/src/permissions/manageable-trash.test.ts`); this
 * file covers the listing's own field shape on top of it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { listManageableTrash } from './listing';
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

describe('listManageableTrash — manage-only visibility', () => {
  test('a subject with no manage grant anywhere sees an empty listing', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    const trashed = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(trashed.ok).toBe(true);

    const outsider = await insertUser();
    expect(await listManageableTrash(sql, { workspaceId, subjectType: 'user', subjectId: outsider })).toEqual([]);
  });

  test('two trashed pages, one manageable: only the manageable one appears', async () => {
    const { workspaceId, ownerId, chapter, page } = await seedTree();
    const otherPage = await insertNode(workspaceId, chapter.id, 'page', 'other');
    await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    await trashNode(sql, { nodeId: otherPage.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });

    const manager = await insertUser();
    await grantManage(workspaceId, page.id, manager);

    const items = await listManageableTrash(sql, { workspaceId, subjectType: 'user', subjectId: manager });
    expect(items.map((i) => i.root.id)).toEqual([page.id]);
  });
});

describe('listManageableTrash — item shape', () => {
  test('location, counts and trashedBy are populated for a trashed container', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'shape-chapter');
    await insertNode(workspaceId, chapter.id, 'page', 'p1');
    await insertNode(workspaceId, chapter.id, 'page', 'p2');
    const result = await trashNode(sql, {
      nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force',
      submitted: { confirmName: 'shape-chapter', acceptedCount: 2 },
    });
    expect(result.ok).toBe(true);
    await grantManage(workspaceId, chapter.id, ownerId);

    const [item] = await listManageableTrash(sql, { workspaceId, subjectType: 'user', subjectId: ownerId });
    expect(item!.root).toEqual({ id: chapter.id, type: 'chapter', title: 'shape-chapter' });
    expect(item!.location).toEqual(['shelf', 'book']);
    expect(item!.pages).toBe(2);
    expect(item!.containers).toBe(0);
    expect(item!.trashedBy?.id).toBe(ownerId);
    expect(item!.daysLeft).toBe(30);
    expect(item!.restoreBlockedBy).toBeNull();
  });

  test('restoreBlockedBy names the trashed ancestor when the parent is itself trashed', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'blocked-parent');
    const page = await insertNode(workspaceId, chapter.id, 'page', 'blocked-page');
    await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    await grantManage(workspaceId, page.id, ownerId);
    // The chapter itself is trashed afterwards, separately.
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()}, trashed_by = ${ownerId} WHERE id = ${chapter.id}`;

    const items = await listManageableTrash(sql, { workspaceId, subjectType: 'user', subjectId: ownerId });
    const item = items.find((i) => i.root.id === page.id);
    expect(item!.restoreBlockedBy).toEqual({ title: 'blocked-parent' });
  });

  test('restoreBlockedBy names the live sibling holding the slug', async () => {
    const { workspaceId, ownerId, chapter, page } = await seedTree();
    await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    await grantManage(workspaceId, page.id, ownerId);
    await insertNode(workspaceId, chapter.id, 'page', 'page');

    const [item] = await listManageableTrash(sql, { workspaceId, subjectType: 'user', subjectId: ownerId });
    expect(item!.restoreBlockedBy).toEqual({ title: 'page' });
  });
});

/**
 * `restoreOperation()` truth table (trash-restore spec, every requirement).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { restoreOperation } from './restore';
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

async function insertNode(
  workspaceId: string,
  parentId: string | null,
  type: string,
  slug: string,
  opts: { trashed?: boolean; trashOperationId?: string; trashedBy?: string } = {},
): Promise<Row> {
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title, trashed_at, trash_operation_id, trashed_by)
    VALUES (
      ${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug},
      ${opts.trashed ? sql`now()` : null}, ${opts.trashOperationId ?? null}, ${opts.trashedBy ?? null}
    )
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
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`u-${crypto.randomUUID()}@example.com`}, 'hash', 'U') RETURNING id
  `;
  return row!.id;
}

describe('restoreOperation — the manage gate (uniform not_found)', () => {
  test('an unknown operation id is not_found', async () => {
    const result = await restoreOperation(sql, { trashOperationId: crypto.randomUUID(), actorId: crypto.randomUUID() });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('a real operation without manage on its root is not_found, identically to unknown', async () => {
    const { chapter, ownerId } = await seedTree();
    const trashResult = await trashNode(sql, { nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force', submitted: { confirmName: 'chapter', acceptedCount: 1 } });
    expect(trashResult.ok).toBe(true);
    const opId = trashResult.ok ? trashResult.trashOperationId : '';

    const outsider = await insertUser();
    const result = await restoreOperation(sql, { trashOperationId: opId, actorId: outsider });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('restoreOperation — co-trashed subtree', () => {
  test('restoring a container restores its co-trashed subtree', async () => {
    const { workspaceId, ownerId, chapter } = await seedTree();
    const trashResult = await trashNode(sql, {
      nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force',
      submitted: { confirmName: 'chapter', acceptedCount: 1 },
    });
    expect(trashResult.ok).toBe(true);
    const opId = trashResult.ok ? trashResult.trashOperationId : '';
    await grantManage(workspaceId, chapter.id, ownerId);

    const result = await restoreOperation(sql, { trashOperationId: opId, actorId: ownerId });
    expect(result.ok).toBe(true);

    const rows = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE trash_operation_id = ${opId}`;
    // The UPDATE clears trash_operation_id too, so no row still carries
    // it — the absence of any row here (rather than all-null) is itself
    // proof the whole op was cleared in one statement.
    expect(rows.length).toBe(0);
    const [chapterRow] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${chapter.id}`;
    expect(chapterRow!.trashed_at).toBeNull();
  });

  test('a separately-trashed descendant stays trashed when its ancestor is restored', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'c-sep');
    const earlyOp = crypto.randomUUID();
    const separatelyTrashedPage = await insertNode(workspaceId, chapter.id, 'page', 'p-sep', { trashed: true, trashOperationId: earlyOp, trashedBy: ownerId });
    await grantManage(workspaceId, separatelyTrashedPage.id, ownerId);

    const trashResult = await trashNode(sql, { nodeId: chapter.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(trashResult.ok).toBe(true);
    const chapterOp = trashResult.ok ? trashResult.trashOperationId : '';
    await grantManage(workspaceId, chapter.id, ownerId);

    const result = await restoreOperation(sql, { trashOperationId: chapterOp, actorId: ownerId });
    expect(result.ok).toBe(true);

    const [chapterRow] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${chapter.id}`;
    expect(chapterRow!.trashed_at).toBeNull();
    const [pageRow] = await sql<{ trashed_at: Date | null; trash_operation_id: string }[]>`SELECT trashed_at, trash_operation_id FROM nodes WHERE id = ${separatelyTrashedPage.id}`;
    expect(pageRow!.trashed_at).not.toBeNull();
    expect(pageRow!.trash_operation_id).toBe(earlyOp);
  });
});

describe('restoreOperation — ancestor still trashed', () => {
  test('restoring a page under a still-trashed chapter is refused, naming the chapter', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapterOp = crypto.randomUUID();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'still-trashed', { trashed: true, trashOperationId: chapterOp, trashedBy: ownerId });
    const pageOp = crypto.randomUUID();
    const page = await insertNode(workspaceId, chapter.id, 'page', 'p-under', { trashed: true, trashOperationId: pageOp, trashedBy: ownerId });
    await grantManage(workspaceId, page.id, ownerId);

    const result = await restoreOperation(sql, { trashOperationId: pageOp, actorId: ownerId });
    expect(result).toEqual({ ok: false, reason: 'ancestor_trashed', ancestor: { title: 'still-trashed' } });

    const [row] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${page.id}`;
    expect(row!.trashed_at).not.toBeNull();
  });

  test('restoring after the ancestor is restored succeeds', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapterOp = crypto.randomUUID();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'now-live', { trashed: true, trashOperationId: chapterOp, trashedBy: ownerId });
    const pageOp = crypto.randomUUID();
    const page = await insertNode(workspaceId, chapter.id, 'page', 'p-under2', { trashed: true, trashOperationId: pageOp, trashedBy: ownerId });
    await grantManage(workspaceId, chapter.id, ownerId);
    await grantManage(workspaceId, page.id, ownerId);
    // A trashed trace row must exist for restore's findTrashedTrace lookup.
    await sql`
      INSERT INTO node_deletions (workspace_id, node_id, node_type, title, location, event, trash_operation_id, actor_id, page_count, restricted)
      VALUES (${workspaceId}, ${chapter.id}, 'chapter', 'now-live', '', 'trashed', ${chapterOp}, ${ownerId}, 0, false)
    `;
    await sql`
      INSERT INTO node_deletions (workspace_id, node_id, node_type, title, location, event, trash_operation_id, actor_id, page_count, restricted)
      VALUES (${workspaceId}, ${page.id}, 'page', 'p-under2', '', 'trashed', ${pageOp}, ${ownerId}, 0, false)
    `;

    const first = await restoreOperation(sql, { trashOperationId: chapterOp, actorId: ownerId });
    expect(first.ok).toBe(true);

    const second = await restoreOperation(sql, { trashOperationId: pageOp, actorId: ownerId });
    expect(second.ok).toBe(true);
  });
});

describe('restoreOperation — slug collision', () => {
  test('a collision on the original slug answers slug_taken, naming the live sibling', async () => {
    const { workspaceId, ownerId, chapter } = await seedTree();
    const trashResult = await trashNode(sql, { nodeId: chapter.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' }, );
    // chapter has a live page — trashNode refuses non-empty. Use force via owner instead for a clean single-page-less container? Simpler: trash the page itself, not the chapter.
    void trashResult;

    const { workspaceId: ws2, ownerId: owner2, book: book2, chapter: chapter2, page } = await seedTree();
    const pageTrash = await trashNode(sql, { nodeId: page.id, actorId: owner2, isOwner: false, hasManage: true, mode: 'trash' });
    expect(pageTrash.ok).toBe(true);
    const opId = pageTrash.ok ? pageTrash.trashOperationId : '';
    await grantManage(ws2, page.id, owner2);

    // A live sibling now holds the trashed page's original slug.
    await insertNode(ws2, chapter2.id, 'page', 'page');

    const result = await restoreOperation(sql, { trashOperationId: opId, actorId: owner2 });
    expect(result).toEqual({ ok: false, reason: 'slug_taken', sibling: { title: 'page' } });
    void workspaceId;
    void book2;
  });

  test('no collision restores under the original slug', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    const result0 = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result0.ok).toBe(true);
    const opId = result0.ok ? result0.trashOperationId : '';
    await grantManage(workspaceId, page.id, ownerId);

    const result = await restoreOperation(sql, { trashOperationId: opId, actorId: ownerId });
    expect(result.ok && result.slug).toBe('page');
  });
});

describe('restoreOperation — restore as', () => {
  test('restore as succeeds with the typed name', async () => {
    const { workspaceId, ownerId, chapter, page } = await seedTree();
    const result0 = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result0.ok).toBe(true);
    const opId = result0.ok ? result0.trashOperationId : '';
    await grantManage(workspaceId, page.id, ownerId);
    await insertNode(workspaceId, chapter.id, 'page', 'page'); // collision on the original slug

    const result = await restoreOperation(sql, { trashOperationId: opId, actorId: ownerId, name: 'Overview 2026' });
    expect(result).toEqual({ ok: true, nodeId: page.id, parentId: chapter.id, slug: 'overview-2026' });

    const [row] = await sql<{ title: string; slug: string }[]>`SELECT title, slug FROM nodes WHERE id = ${page.id}`;
    expect(row).toEqual({ title: 'Overview 2026', slug: 'overview-2026' });
  });

  test('a second collision on the typed name is refused the same way, no automatic suffix', async () => {
    const { workspaceId, ownerId, chapter, page } = await seedTree();
    const result0 = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result0.ok).toBe(true);
    const opId = result0.ok ? result0.trashOperationId : '';
    await grantManage(workspaceId, page.id, ownerId);
    await insertNode(workspaceId, chapter.id, 'page', 'renamed-page');

    const result = await restoreOperation(sql, { trashOperationId: opId, actorId: ownerId, name: 'Renamed Page' });
    expect(result).toEqual({ ok: false, reason: 'slug_taken', sibling: { title: 'renamed-page' } });

    const [row] = await sql<{ slug: string }[]>`SELECT slug FROM nodes WHERE id = ${page.id}`;
    // Never a minted suffix — the node keeps its pre-restore slug untouched.
    expect(row!.slug).toBe('page');
  });
});

describe('restoreOperation — position', () => {
  test('the restored root goes to the end of its parent’s live children', async () => {
    const { workspaceId, ownerId, chapter, page } = await seedTree();
    await insertNode(workspaceId, chapter.id, 'page', 'sibling-a', {});
    const result0 = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result0.ok).toBe(true);
    const opId = result0.ok ? result0.trashOperationId : '';
    await grantManage(workspaceId, page.id, ownerId);
    await insertNode(workspaceId, chapter.id, 'page', 'sibling-b', {});

    const result = await restoreOperation(sql, { trashOperationId: opId, actorId: ownerId });
    expect(result.ok).toBe(true);

    const [row] = await sql<{ position: number }[]>`SELECT position FROM nodes WHERE id = ${page.id}`;
    // sibling-a (0), page (1, trashed then restored), sibling-b (1 at
    // insert time, now 2 live siblings before restore) — position must
    // land after every currently-live sibling.
    const siblings = await sql<{ id: string; position: number }[]>`SELECT id, position FROM live_nodes WHERE parent_id = ${chapter.id} ORDER BY position`;
    expect(siblings.at(-1)!.id).toBe(page.id);
    void row;
  });
});

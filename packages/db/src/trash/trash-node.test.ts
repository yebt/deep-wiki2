/**
 * `trashNode()` truth table (node-trash spec, every requirement). The
 * dimensions are exactly `decideTrash()`'s own: `isOwner`, `hasManage`,
 * `isContainer`, live descendant counts, and `submitted` — plus this
 * layer's own `not_found` case (the `read`-gate 404 the route itself
 * enforces is not this function's concern; see the file header).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { ancestorTitles, trashNode } from './trash-node';

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

describe('trashNode — the read-gate boundary (not_found vs forbidden)', () => {
  test('an unknown node id is not_found', async () => {
    const result = await trashNode(sql, {
      nodeId: crypto.randomUUID(), actorId: crypto.randomUUID(), isOwner: false, hasManage: false, mode: 'trash',
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('an already-trashed node id is not_found, identically to unknown', async () => {
    const { workspaceId, ownerId } = await seedWorkspace();
    const root = await insertNode(workspaceId, null, 'workspace', 'root');
    const trashed = await insertNode(workspaceId, root.id, 'shelf', 'gone', { trashed: true, trashOperationId: crypto.randomUUID(), trashedBy: ownerId });

    const result = await trashNode(sql, { nodeId: trashed.id, actorId: crypto.randomUUID(), isOwner: false, hasManage: false, mode: 'trash' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('a caller with neither manage nor owner is forbidden', async () => {
    const { chapter } = await seedTree();
    const result = await trashNode(sql, { nodeId: chapter.id, actorId: crypto.randomUUID(), isOwner: false, hasManage: false, mode: 'trash' });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('trashNode — empty container and page rules', () => {
  test('manage subject trashes an empty container', async () => {
    // A fresh chapter, deliberately with no children — seedTree()'s own
    // chapter already carries one page.
    const { workspaceId, ownerId, book } = await seedTree();
    const emptyChapter = await insertNode(workspaceId, book.id, 'chapter', 'empty-chapter');

    const result = await trashNode(sql, { nodeId: emptyChapter.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trashed).toEqual({ pages: 0, containers: 0 });

    const [row] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${emptyChapter.id}`;
    expect(row!.trashed_at).not.toBeNull();
  });

  test('a manage subject trashes a page with no container restriction', async () => {
    const { page, ownerId } = await seedTree();
    const result = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result).toEqual({ ok: true, trashOperationId: expect.any(String), trashed: { pages: 0, containers: 0 } });
  });

  test('non-owner manager cannot trash a non-empty chapter (not_empty, no row changes)', async () => {
    const { chapter, ownerId } = await seedTree();
    const result = await trashNode(sql, { nodeId: chapter.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result).toEqual({ ok: false, reason: 'not_empty', live: { pages: 1, containers: 0 } });

    const [row] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${chapter.id}`;
    expect(row!.trashed_at).toBeNull();
  });

  test('a chapter whose only child page was trashed separately is treated as empty', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'c2');
    await insertNode(workspaceId, chapter.id, 'page', 'p2', { trashed: true, trashOperationId: crypto.randomUUID(), trashedBy: ownerId });

    const result = await trashNode(sql, { nodeId: chapter.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result).toEqual({ ok: true, trashOperationId: expect.any(String), trashed: { pages: 0, containers: 0 } });
  });
});

describe('trashNode — owner force-delete', () => {
  test('correct name and current count succeeds, trashing the container and its live pages', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'force-chapter');
    await insertNode(workspaceId, chapter.id, 'page', 'p1');
    await insertNode(workspaceId, chapter.id, 'page', 'p2');
    await insertNode(workspaceId, chapter.id, 'page', 'p3');

    const result = await trashNode(sql, {
      nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force',
      submitted: { confirmName: 'force-chapter', acceptedCount: 3 },
    });
    expect(result).toEqual({ ok: true, trashOperationId: expect.any(String), trashed: { pages: 3, containers: 0 } });

    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE trash_operation_id = ${result.ok ? result.trashOperationId : ''}`;
    // chapter + 3 pages, one shared operation id.
    expect(rows.length).toBe(4);
  });

  test('a stale count is refused and no row changes', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'stale-chapter');
    await insertNode(workspaceId, chapter.id, 'page', 'p1');
    await insertNode(workspaceId, chapter.id, 'page', 'p2');
    await insertNode(workspaceId, chapter.id, 'page', 'p3');
    // A fourth page arrives after the confirmation was shown.
    await insertNode(workspaceId, chapter.id, 'page', 'p4');

    const result = await trashNode(sql, {
      nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force',
      submitted: { confirmName: 'stale-chapter', acceptedCount: 3 },
    });
    expect(result).toEqual({ ok: false, reason: 'stale_count', live: { pages: 4, containers: 0 } });

    const [row] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${chapter.id}`;
    expect(row!.trashed_at).toBeNull();
  });

  test('the force count excludes an already-trashed page, and it keeps its own operation id', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'excl-chapter');
    const livePage = await insertNode(workspaceId, chapter.id, 'page', 'live-page');
    const oldOp = crypto.randomUUID();
    const trashedPage = await insertNode(workspaceId, chapter.id, 'page', 'trashed-page', { trashed: true, trashOperationId: oldOp, trashedBy: ownerId });

    const result = await trashNode(sql, {
      nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force',
      submitted: { confirmName: 'excl-chapter', acceptedCount: 1 },
    });
    expect(result).toEqual({ ok: true, trashOperationId: expect.any(String), trashed: { pages: 1, containers: 0 } });

    const [before] = await sql<{ trash_operation_id: string }[]>`SELECT trash_operation_id FROM nodes WHERE id = ${trashedPage.id}`;
    expect(before!.trash_operation_id).toBe(oldOp);
    const [after] = await sql<{ trashed_at: Date | null }[]>`SELECT trashed_at FROM nodes WHERE id = ${livePage.id}`;
    expect(after!.trashed_at).not.toBeNull();
  });

  test('a wrong name is refused with name_mismatch', async () => {
    const { workspaceId, ownerId, book } = await seedTree();
    const chapter = await insertNode(workspaceId, book.id, 'chapter', 'name-chapter');
    await insertNode(workspaceId, chapter.id, 'page', 'p1');

    const result = await trashNode(sql, {
      nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force',
      submitted: { confirmName: 'wrong-name', acceptedCount: 1 },
    });
    expect(result).toEqual({ ok: false, reason: 'name_mismatch' });
  });

  test('the plain trash route always refuses a non-empty container, even for the owner', async () => {
    const { chapter, ownerId } = await seedTree();
    const result = await trashNode(sql, { nodeId: chapter.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'trash' });
    expect(result).toEqual({ ok: false, reason: 'not_empty', live: { pages: 1, containers: 0 } });
  });
});

describe('trashNode — subtree propagation atomicity', () => {
  test('trashing a book trashes the book, its chapter and both pages under one operation id', async () => {
    const { workspaceId, ownerId, book, chapter } = await seedTree();
    await insertNode(workspaceId, chapter.id, 'page', 'second-page');

    const result = await trashNode(sql, {
      nodeId: book.id, actorId: ownerId, isOwner: true, hasManage: false, mode: 'force',
      submitted: { confirmName: 'book', acceptedCount: 2 },
    });
    expect(result.ok).toBe(true);

    const opId = result.ok ? result.trashOperationId : '';
    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE trash_operation_id = ${opId}`;
    // book + chapter + 2 pages.
    expect(rows.length).toBe(4);
  });
});

describe('trashNode — trace and page-lock release', () => {
  test('trashing a page appends a trace row naming the title, actor and event', async () => {
    const { page, ownerId } = await seedTree();

    const result = await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });
    expect(result.ok).toBe(true);

    const [trace] = await sql<{ title: string; event: string; actor_id: string }[]>`SELECT title, event, actor_id FROM node_deletions WHERE node_id = ${page.id}`;
    expect(trace).toEqual({ title: 'page', event: 'trashed', actor_id: ownerId });
  });

  test('trashing a page releases its page lock', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${page.id}, ${workspaceId}, '# Page\n', 'hash')
    `;
    const [holder] = await sql<{ id: string }[]>`INSERT INTO users (email, password_hash, display_name) VALUES (${`holder-${crypto.randomUUID()}@example.com`}, 'hash', 'Holder') RETURNING id`;
    await sql`INSERT INTO page_locks (node_id, workspace_id, holder_user_id) VALUES (${page.id}, ${workspaceId}, ${holder!.id})`;

    await trashNode(sql, { nodeId: page.id, actorId: ownerId, isOwner: false, hasManage: true, mode: 'trash' });

    const rows = await sql<{ node_id: string }[]>`SELECT node_id FROM page_locks WHERE node_id = ${page.id}`;
    expect(rows.length).toBe(0);
  });
});

describe('ancestorTitles', () => {
  test('joins the ancestor chain excluding the workspace root', async () => {
    const { chapter } = await seedTree();
    const titles = await ancestorTitles(sql, { parentId: chapter.id });
    expect(titles).toEqual(['shelf', 'book', 'chapter']);
  });

  test('an item directly under the workspace root has an empty ancestor chain', async () => {
    const { root } = await seedTree();
    expect(await ancestorTitles(sql, { parentId: root.id })).toEqual([]);
  });

  test('null parentId (defensive) returns an empty chain', async () => {
    expect(await ancestorTitles(sql, { parentId: null })).toEqual([]);
  });
});

/**
 * `purgeTrash()` truth table (trash-purge spec, every requirement).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { purgeTrash } from './purge';

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
  opts: { trashedDaysAgo?: number; trashOperationId?: string; trashedBy?: string } = {},
): Promise<Row> {
  const trashedAt = opts.trashedDaysAgo !== undefined ? `now() - interval '${opts.trashedDaysAgo} days'` : null;
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title, trashed_at, trash_operation_id, trashed_by)
    VALUES (
      ${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug},
      ${trashedAt ? sql.unsafe(trashedAt) : null}, ${opts.trashOperationId ?? null}, ${opts.trashedBy ?? null}
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

async function trashRow(nodeId: string, daysAgo: number, opId: string, trashedBy: string): Promise<void> {
  await sql`
    UPDATE nodes SET trashed_at = now() - ${`${daysAgo} days`}::interval, trash_operation_id = ${opId}, trashed_by = ${trashedBy}
     WHERE id = ${nodeId}
  `;
}

async function appendTrashedTrace(workspaceId: string, nodeId: string, nodeType: string, title: string, opId: string, actorId: string, bookId: string | null = null): Promise<void> {
  await sql`
    INSERT INTO node_deletions (workspace_id, book_id, node_id, node_type, title, location, event, trash_operation_id, actor_id, page_count, restricted)
    VALUES (${workspaceId}, ${bookId}, ${nodeId}, ${nodeType}::node_type, ${title}, '', 'trashed', ${opId}, ${actorId}, 0, false)
  `;
}

describe('purgeTrash — 30-day boundary', () => {
  test('a node trashed 29 days ago is untouched', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    const opId = crypto.randomUUID();
    await trashRow(page.id, 29, opId, ownerId);
    await appendTrashedTrace(workspaceId, page.id, 'page', 'page', opId, ownerId);

    const result = await purgeTrash(sql, { workspaceId });
    expect(result.purgedNodes).toBe(0);

    const [row] = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE id = ${page.id}`;
    expect(row).toBeDefined();
  });

  test('a node trashed 31 days ago is purged', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    const opId = crypto.randomUUID();
    await trashRow(page.id, 31, opId, ownerId);
    await appendTrashedTrace(workspaceId, page.id, 'page', 'page', opId, ownerId);

    const result = await purgeTrash(sql, { workspaceId });
    expect(result.purgedNodes).toBe(1);

    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE id = ${page.id}`;
    expect(rows.length).toBe(0);
  });
});

describe('purgeTrash — tracked, idempotent run', () => {
  test('records a run through completed', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    const opId = crypto.randomUUID();
    await trashRow(page.id, 31, opId, ownerId);
    await appendTrashedTrace(workspaceId, page.id, 'page', 'page', opId, ownerId);

    const result = await purgeTrash(sql, { workspaceId });

    const [run] = await sql<{ state: string; purged_nodes: number }[]>`SELECT state, purged_nodes FROM trash_purge_runs WHERE id = ${result.runId}`;
    expect(run).toEqual({ state: 'completed', purged_nodes: 1 });
  });

  test('re-running a completed purge with nothing newly eligible changes nothing', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    const opId = crypto.randomUUID();
    await trashRow(page.id, 31, opId, ownerId);
    await appendTrashedTrace(workspaceId, page.id, 'page', 'page', opId, ownerId);

    await purgeTrash(sql, { workspaceId });
    const second = await purgeTrash(sql, { workspaceId });

    expect(second.purgedNodes).toBe(0);
    const [run] = await sql<{ state: string }[]>`SELECT state FROM trash_purge_runs WHERE id = ${second.runId}`;
    expect(run!.state).toBe('completed');
  });
});

describe('purgeTrash — cascade inventory', () => {
  test('purging a page removes its content, revisions, comment and chunks', async () => {
    const { workspaceId, ownerId, page } = await seedTree();
    const opId = crypto.randomUUID();

    await sql`INSERT INTO page_content (node_id, workspace_id, markdown, content_hash) VALUES (${page.id}, ${workspaceId}, '# Page\n', 'hash')`;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${page.id}, ${workspaceId}, 'b1', 'active', 'hash', 'excerpt')
    `;
    await sql`
      INSERT INTO comments (workspace_id, page_id, author_id, body, block_id, status)
      VALUES (${workspaceId}, ${page.id}, ${ownerId}, 'A comment', 'b1', 'anchored')
    `;
    await sql`INSERT INTO page_revision (workspace_id, page_id, content, content_hash) VALUES (${workspaceId}, ${page.id}, '# Page v1\n', 'hash-1')`;
    await sql`INSERT INTO page_revision (workspace_id, page_id, content, content_hash) VALUES (${workspaceId}, ${page.id}, '# Page v2\n', 'hash-2')`;
    await sql`
      INSERT INTO workspace_embedding_indexes (workspace_id, embedding_provider, embedding_model, dimensions, state)
      VALUES (${workspaceId}, 'openai', 'text-embedding-3-small', 1536, 'active')
    `;
    await sql`
      INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
      VALUES (${workspaceId}, ${page.id}, 'chunk text', ${sql.unsafe(`'[${Array(1536).fill('0').join(',')}]'::vector`)}, 'text-embedding-3-small', 1536)
    `;

    await trashRow(page.id, 31, opId, ownerId);
    await appendTrashedTrace(workspaceId, page.id, 'page', 'page', opId, ownerId);

    await purgeTrash(sql, { workspaceId });

    const [content, revisions, comments, chunks] = await Promise.all([
      sql`SELECT node_id FROM page_content WHERE node_id = ${page.id}`,
      sql`SELECT id FROM page_revision WHERE page_id = ${page.id}`,
      sql`SELECT id FROM comments WHERE page_id = ${page.id}`,
      sql`SELECT id FROM chunks WHERE page_id = ${page.id}`,
    ]);
    expect(content.length).toBe(0);
    expect(revisions.length).toBe(0);
    expect(comments.length).toBe(0);
    expect(chunks.length).toBe(0);
  });

  test('purging a book removes its changeset', async () => {
    const { workspaceId, ownerId, book, chapter, page } = await seedTree();
    const opId = crypto.randomUUID();

    await sql`INSERT INTO page_content (node_id, workspace_id, markdown, content_hash) VALUES (${page.id}, ${workspaceId}, '# Page\n', 'hash')`;
    const [changeset] = await sql<{ id: string }[]>`
      INSERT INTO changeset (workspace_id, book_id, author_id) VALUES (${workspaceId}, ${book.id}, ${ownerId}) RETURNING id
    `;
    await sql`INSERT INTO page_revision (workspace_id, page_id, content, content_hash, changeset_id) VALUES (${workspaceId}, ${page.id}, '# Page\n', 'hash', ${changeset!.id})`;

    // Trash the whole subtree together, sharing one op — book, chapter, page.
    await trashRow(book.id, 31, opId, ownerId);
    await trashRow(chapter.id, 31, opId, ownerId);
    await trashRow(page.id, 31, opId, ownerId);
    await appendTrashedTrace(workspaceId, book.id, 'book', 'book', opId, ownerId, book.id);

    await purgeTrash(sql, { workspaceId });

    const rows = await sql<{ id: string }[]>`SELECT id FROM changeset WHERE id = ${changeset!.id}`;
    expect(rows.length).toBe(0);
  });
});

describe('purgeTrash — deletion trace survival', () => {
  test('a trashed operation root gets a purged trace row, and the trashed row remains after purge', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opId = crypto.randomUUID();
    await trashRow(page.id, 31, opId, ownerId);
    await appendTrashedTrace(workspaceId, page.id, 'page', 'page', opId, ownerId, book.id);

    await purgeTrash(sql, { workspaceId });

    const rows = await sql<{ event: string }[]>`SELECT event FROM node_deletions WHERE node_id = ${page.id} ORDER BY occurred_at`;
    expect(rows.map((r) => r.event)).toEqual(['trashed', 'purged']);
  });

  test('a co-trashed descendant with no trashed row of its own gets no purged row, but is still deleted', async () => {
    const { workspaceId, ownerId, book, chapter, page } = await seedTree();
    const opId = crypto.randomUUID();
    // Only the chapter (the op root) has its own trashed trace row; page is
    // a propagated descendant sharing the same operation id.
    await trashRow(chapter.id, 31, opId, ownerId);
    await trashRow(page.id, 31, opId, ownerId);
    await appendTrashedTrace(workspaceId, chapter.id, 'chapter', 'chapter', opId, ownerId, book.id);

    await purgeTrash(sql, { workspaceId });

    const pageTraceRows = await sql<{ id: string }[]>`SELECT id FROM node_deletions WHERE node_id = ${page.id}`;
    expect(pageTraceRows.length).toBe(0);
    const pageRows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE id = ${page.id}`;
    expect(pageRows.length).toBe(0);
  });
});

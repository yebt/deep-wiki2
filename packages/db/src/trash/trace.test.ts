/**
 * `node_deletions` trace truth table (deletion-trace spec, every
 * requirement). The `restricted` flag's actual disclosure filtering ("hide
 * the title from a subject without access", "show it to one who could have
 * read the node") is route-layer work per design.md Decision 5's
 * "Disclosure" paragraph (`canManyResources(read)` while the row exists,
 * `manage` on the book after purge) — `apps/api/src/routes/revisions.ts`,
 * Phase 6 of this change. This module only stores and returns the flag
 * faithfully; that faithfulness is what this file's restricted-flag tests
 * prove.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { appendTrace, findTrashedTrace } from './trace';

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

interface Row {
  id: string;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string): Promise<Row> {
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug})
    RETURNING id
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

describe('appendTrace — the three events', () => {
  test('a trashed event is recorded', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opId = crypto.randomUUID();

    await appendTrace(sql, {
      workspaceId,
      bookId: book.id,
      nodeId: page.id,
      nodeType: 'page',
      title: 'Overview',
      location: 'Shelf › Book',
      event: 'trashed',
      trashOperationId: opId,
      actorId: ownerId,
      pageCount: 1,
      restricted: false,
    });

    const [row] = await sql<{ event: string; title: string }[]>`SELECT event, title FROM node_deletions WHERE node_id = ${page.id}`;
    expect(row).toEqual({ event: 'trashed', title: 'Overview' });
  });

  test('a restore appends a second, distinct row and leaves the trash row unchanged', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opId = crypto.randomUUID();

    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Overview', location: 'Shelf › Book',
      event: 'trashed', trashOperationId: opId, actorId: ownerId, pageCount: 1, restricted: false,
    });
    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Overview', location: 'Shelf › Book',
      event: 'restored', trashOperationId: opId, actorId: ownerId, pageCount: 1, restricted: false,
    });

    const rows = await sql<{ event: string }[]>`SELECT event FROM node_deletions WHERE node_id = ${page.id} ORDER BY occurred_at`;
    expect(rows.map((r) => r.event)).toEqual(['trashed', 'restored']);
  });

  test('a purged event is recorded distinctly from trashed/restored', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opId = crypto.randomUUID();

    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Overview', location: 'Shelf › Book',
      event: 'purged', trashOperationId: opId, actorId: ownerId, pageCount: 0, restricted: false,
    });

    const [row] = await sql<{ event: string }[]>`SELECT event FROM node_deletions WHERE node_id = ${page.id}`;
    expect(row!.event).toBe('purged');
  });
});

describe('append-only', () => {
  test('an UPDATE on an existing trace row raises', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opId = crypto.randomUUID();
    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Overview', location: 'Shelf › Book',
      event: 'trashed', trashOperationId: opId, actorId: ownerId, pageCount: 1, restricted: false,
    });

    await expect(
      (async () => {
        await sql`UPDATE node_deletions SET title = 'Renamed' WHERE node_id = ${page.id}`;
      })(),
    ).rejects.toThrow(/immutable/);

    const [row] = await sql<{ title: string }[]>`SELECT title FROM node_deletions WHERE node_id = ${page.id}`;
    expect(row!.title).toBe('Overview');
  });
});

describe('no cascading foreign key to the deleted node', () => {
  test('deleting the node row directly leaves the trace row intact', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opId = crypto.randomUUID();
    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Overview', location: 'Shelf › Book',
      event: 'trashed', trashOperationId: opId, actorId: ownerId, pageCount: 1, restricted: false,
    });

    // node_id carries no foreign key on purpose (design.md Decision 5) — a
    // direct DELETE of the node row (standing in for the purge job's own
    // DELETE FROM nodes) must not touch this trace row at all.
    await sql`DELETE FROM nodes WHERE id = ${page.id}`;

    const [row] = await sql<{ id: string }[]>`SELECT id FROM node_deletions WHERE node_id = ${page.id}`;
    expect(row).toBeDefined();
  });
});

describe('cascades only with the book', () => {
  test('purging the book removes its trace rows', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opId = crypto.randomUUID();
    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Overview', location: 'Shelf › Book',
      event: 'trashed', trashOperationId: opId, actorId: ownerId, pageCount: 1, restricted: false,
    });

    await sql`DELETE FROM nodes WHERE id = ${book.id}`;

    const rows = await sql<{ id: string }[]>`SELECT id FROM node_deletions WHERE book_id = ${book.id}`;
    expect(rows.length).toBe(0);
  });

  test('purging one page does not remove the book’s other trace rows', async () => {
    const { workspaceId, ownerId, book, chapter, page } = await seedTree();
    const otherPage = await insertNode(workspaceId, chapter.id, 'page', 'other-page');
    const opA = crypto.randomUUID();
    const opB = crypto.randomUUID();

    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Page A', location: 'Shelf › Book',
      event: 'trashed', trashOperationId: opA, actorId: ownerId, pageCount: 1, restricted: false,
    });
    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: otherPage.id, nodeType: 'page', title: 'Page B', location: 'Shelf › Book',
      event: 'trashed', trashOperationId: opB, actorId: ownerId, pageCount: 1, restricted: false,
    });

    // Purging page A's node row (standing in for the purge job's DELETE)
    // touches no trace row at all — node_id carries no foreign key — so
    // both A's own trace row and B's survive; only a book-level purge
    // (tested above) can remove either.
    await sql`DELETE FROM nodes WHERE id = ${page.id}`;

    const remaining = await sql<{ node_id: string }[]>`SELECT node_id FROM node_deletions WHERE book_id = ${book.id} ORDER BY title`;
    expect(remaining.map((r) => r.node_id).sort()).toEqual([otherPage.id, page.id].sort());
  });
});

describe('findTrashedTrace', () => {
  test('finds the exact trashed row for this node and operation, not a stale one from an earlier cycle', async () => {
    const { workspaceId, ownerId, book, page } = await seedTree();
    const opOld = crypto.randomUUID();
    const opNew = crypto.randomUUID();

    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'Old Title', location: 'Shelf › Book',
      event: 'trashed', trashOperationId: opOld, actorId: ownerId, pageCount: 1, restricted: true,
    });
    await appendTrace(sql, {
      workspaceId, bookId: book.id, nodeId: page.id, nodeType: 'page', title: 'New Title', location: 'Shelf › Book › Chapter',
      event: 'trashed', trashOperationId: opNew, actorId: ownerId, pageCount: 2, restricted: false,
    });

    const found = await findTrashedTrace(sql, { nodeId: page.id, trashOperationId: opNew });
    expect(found).toEqual({ bookId: book.id, nodeType: 'page', title: 'New Title', location: 'Shelf › Book › Chapter', pageCount: 2, restricted: false });

    const foundOld = await findTrashedTrace(sql, { nodeId: page.id, trashOperationId: opOld });
    expect(foundOld?.title).toBe('Old Title');
    expect(foundOld?.restricted).toBe(true);
  });

  test('returns null when no trashed row exists for that operation', async () => {
    const { page } = await seedTree();
    expect(await findTrashedTrace(sql, { nodeId: page.id, trashOperationId: crypto.randomUUID() })).toBeNull();
  });
});

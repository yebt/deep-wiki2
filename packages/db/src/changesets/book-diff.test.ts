/**
 * Book-level "what changed since <date>" aggregation (block-diff spec:
 * "Book-Level Diff Aggregates Changed Pages Since A Date"). Computed from
 * `page_revision.changeset_id` joined to `changeset.book_id` — never from
 * a second, independent change log.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from '../content/save-page';
import { listChangedPagesSince } from './book-diff';

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

const WINDOW_MINUTES = 30;

async function seedWorkspaceAndBook(): Promise<{ workspaceId: string; rootId: string; bookId: string; authorId: string }> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [book] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Book') RETURNING id
  `;
  return { workspaceId: ws!.id, rootId: root!.id, bookId: book!.id, authorId: owner!.id };
}

async function seedPageUnder(workspaceId: string, parentId: string): Promise<string> {
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return page!.id;
}

async function seedSiblingBook(workspaceId: string, rootId: string): Promise<string> {
  const [book] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'book', '', 1, ${`book-${crypto.randomUUID()}`}, 'Other Book') RETURNING id
  `;
  return book!.id;
}

describe('listChangedPagesSince', () => {
  test('lists every page touched by a changeset in range, each with the revision immediately preceding the date as baseline', async () => {
    const { workspaceId, bookId, authorId } = await seedWorkspaceAndBook();
    const pageA = await seedPageUnder(workspaceId, bookId);
    const pageB = await seedPageUnder(workspaceId, bookId);

    // Baseline saves, before the cutoff.
    const baselineA = await savePage(sql, {
      nodeId: pageA,
      workspaceId,
      markdown: '# A before\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    const baselineB = await savePage(sql, {
      nodeId: pageB,
      workspaceId,
      markdown: '# B before\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    // A cutoff strictly after both baseline saves.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const since = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const latestA = await savePage(sql, {
      nodeId: pageA,
      workspaceId,
      markdown: '# A after\n',
      expectedContentHash: baselineA.contentHash,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    const latestB = await savePage(sql, {
      nodeId: pageB,
      workspaceId,
      markdown: '# B after\n',
      expectedContentHash: baselineB.contentHash,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    void latestA;
    void latestB;

    const result = await listChangedPagesSince(sql, { workspaceId, bookId, since });

    expect(result).toHaveLength(2);
    const byPage = new Map(result.map((r) => [r.pageId, r]));
    expect(byPage.get(pageA)?.baselineRevisionId).not.toBeNull();
    expect(byPage.get(pageB)?.baselineRevisionId).not.toBeNull();
    expect(byPage.get(pageA)?.latestRevisionId).not.toBe(byPage.get(pageA)?.baselineRevisionId);
  });

  test('a page created and first saved entirely after the cutoff has no baseline revision', async () => {
    const { workspaceId, bookId, authorId } = await seedWorkspaceAndBook();
    const since = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newPage = await seedPageUnder(workspaceId, bookId);

    await savePage(sql, {
      nodeId: newPage,
      workspaceId,
      markdown: '# Brand new\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const result = await listChangedPagesSince(sql, { workspaceId, bookId, since });

    expect(result).toHaveLength(1);
    expect(result[0]?.baselineRevisionId).toBeNull();
  });

  test('a changeset in a different book is never included', async () => {
    const { workspaceId, rootId, bookId, authorId } = await seedWorkspaceAndBook();
    const otherBookId = await seedSiblingBook(workspaceId, rootId);
    const pageInOtherBook = await seedPageUnder(workspaceId, otherBookId);
    const since = new Date(Date.now() - 60_000);

    await savePage(sql, {
      nodeId: pageInOtherBook,
      workspaceId,
      markdown: '# Other book\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const result = await listChangedPagesSince(sql, { workspaceId, bookId, since });

    expect(result).toHaveLength(0);
  });

  // trash-non-disclosure spec: "diff" is a named read surface — a trashed
  // page's revisions must not surface in the book-level diff aggregation,
  // though other pages in the same book still do.
  test('excludes a trashed page, but another page in the same book still appears', async () => {
    const { workspaceId, bookId, authorId } = await seedWorkspaceAndBook();
    const trashedPage = await seedPageUnder(workspaceId, bookId);
    const otherPage = await seedPageUnder(workspaceId, bookId);
    const since = new Date(Date.now() - 60_000);

    await savePage(sql, {
      nodeId: trashedPage,
      workspaceId,
      markdown: '# Trashed page\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    await savePage(sql, {
      nodeId: otherPage,
      workspaceId,
      markdown: '# Other page\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${trashedPage}`;

    const result = await listChangedPagesSince(sql, { workspaceId, bookId, since });

    expect(result.map((r) => r.pageId)).toEqual([otherPage]);
  });
});

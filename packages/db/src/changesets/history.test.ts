/**
 * Book-level changeset history (changesets spec: "Book-Level History Is One
 * Query" — the input the book-level diff screen needs).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from '../content/save-page';
import { listBookHistory } from './history';

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

async function seedWorkspace(): Promise<{ workspaceId: string; rootId: string }> {
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
  return { workspaceId: ws!.id, rootId: root!.id };
}

async function seedBook(workspaceId: string, parentId: string): Promise<string> {
  const [book] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Book') RETURNING id
  `;
  return book!.id;
}

async function seedChapterUnder(workspaceId: string, parentId: string): Promise<string> {
  const [chapter] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, 'chapter', '', 0, ${`chapter-${crypto.randomUUID()}`}, 'Chapter') RETURNING id
  `;
  return chapter!.id;
}

async function seedPageUnder(workspaceId: string, parentId: string): Promise<string> {
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return page!.id;
}

async function seedUser(displayName: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${displayName.toLowerCase()}-${crypto.randomUUID()}@example.com`}, 'hash', ${displayName})
    RETURNING id
  `;
  return user!.id;
}

const WINDOW_MINUTES = 30;

describe('listBookHistory', () => {
  // The trap: a fixture whose pages all sit directly under the book passes
  // even for an implementation that never walks past the page's own parent
  // to resolve the book at read time. `resolveBookId` runs at *save* time,
  // so the read side simply trusts `changeset.book_id` — but that trust is
  // only proven by a page nested at least one level below the book.
  test('includes revisions from a page nested under a chapter, not only direct children', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const chapterId = await seedChapterUnder(workspaceId, bookId);
    const nestedPageId = await seedPageUnder(workspaceId, chapterId);
    const authorId = await seedUser('Author');

    await savePage(sql, {
      nodeId: nestedPageId,
      workspaceId,
      markdown: '# Nested\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const history = await listBookHistory(sql, { bookId, workspaceId });

    expect(history).toHaveLength(1);
    expect(history[0]!.revisions).toHaveLength(1);
    expect(history[0]!.revisions[0]!.pageId).toBe(nestedPageId);
  });

  test('a changeset with no message is still returned, with a null message', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const pageId = await seedPageUnder(workspaceId, bookId);
    const authorId = await seedUser('Author');
    await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# One\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const [changeset] = await listBookHistory(sql, { bookId, workspaceId });

    expect(changeset!.message).toBeNull();
  });

  test('carries the author display name and the window the changeset\'s revisions span', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const pageId = await seedPageUnder(workspaceId, bookId);
    const authorId = await seedUser('Writer');
    const first = await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# One\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# One\n\n# Two\n',
      expectedContentHash: first.contentHash,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const [changeset] = await listBookHistory(sql, { bookId, workspaceId });

    expect(changeset!.authorId).toBe(authorId);
    expect(changeset!.authorDisplayName).toBe('Writer');
    expect(changeset!.revisions).toHaveLength(2);
    expect(new Date(changeset!.windowStart).getTime()).toBeLessThanOrEqual(new Date(changeset!.windowEnd).getTime());
  });

  test('two changesets are returned newest first', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const pageId = await seedPageUnder(workspaceId, bookId);
    const authorId = await seedUser('Author');

    const first = await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# One\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    const [firstChangesetRow] = await sql<{ changeset_id: string | null }[]>`
      SELECT changeset_id FROM page_revision WHERE page_id = ${pageId} ORDER BY created_at ASC LIMIT 1
    `;
    // Force the first changeset's window to have lapsed so the second save
    // opens a genuinely new, later changeset.
    await sql`UPDATE changeset SET last_activity_at = now() - interval '2 hours' WHERE id = ${firstChangesetRow!.changeset_id}`;

    await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# Two\n',
      expectedContentHash: first.contentHash,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const history = await listBookHistory(sql, { bookId, workspaceId });

    expect(history).toHaveLength(2);
    expect(history[0]!.id).not.toBe(history[1]!.id);
    expect(new Date(history[0]!.windowEnd).getTime()).toBeGreaterThanOrEqual(new Date(history[1]!.windowEnd).getTime());
  });

  test('a changeset in a different book is never included', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const otherBookId = await seedBook(workspaceId, rootId);
    const otherPageId = await seedPageUnder(workspaceId, otherBookId);
    const authorId = await seedUser('Author');
    await savePage(sql, {
      nodeId: otherPageId,
      workspaceId,
      markdown: '# Other\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const history = await listBookHistory(sql, { bookId, workspaceId });

    expect(history).toEqual([]);
  });

  test('a book with no changesets returns an empty array', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);

    const history = await listBookHistory(sql, { bookId, workspaceId });

    expect(history).toEqual([]);
  });

  // changesets spec: "A trashed page's revisions are excluded for a
  // non-manager" — though other pages' revisions in the same changeset
  // still appear.
  test('a trashed page’s revisions are excluded, but the same changeset’s other page still appears', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const trashedPageId = await seedPageUnder(workspaceId, bookId);
    const otherPageId = await seedPageUnder(workspaceId, bookId);
    const authorId = await seedUser('Author');
    await savePage(sql, {
      nodeId: trashedPageId,
      workspaceId,
      markdown: '# Trashed page\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    await savePage(sql, {
      nodeId: otherPageId,
      workspaceId,
      markdown: '# Other page\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${trashedPageId}`;

    const history = await listBookHistory(sql, { bookId, workspaceId });

    expect(history).toHaveLength(1);
    expect(history[0]!.revisions.map((r) => r.pageId)).toEqual([otherPageId]);
  });

  test('a changeset entirely about a trashed page is absent from the history', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const pageId = await seedPageUnder(workspaceId, bookId);
    const authorId = await seedUser('Author');
    await savePage(sql, {
      nodeId: pageId,
      workspaceId,
      markdown: '# One\n',
      expectedContentHash: null,
      updatedBy: authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${pageId}`;

    const history = await listBookHistory(sql, { bookId, workspaceId });

    expect(history).toEqual([]);
  });
});

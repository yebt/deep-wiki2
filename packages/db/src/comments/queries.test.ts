import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, TEST_CHANGESET_WINDOW_MINUTES, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from '../content/save-page';
import { createReply, createRootComment, listCommentIndicators, listCommentThreads, listOpenThreadsForUser, setThreadResolved } from './queries';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 1 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function seedWorkspace(): Promise<{ workspaceId: string; rootId: string }> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  return { workspaceId: workspace!.id as string, rootId: root!.id as string };
}

async function seedPage(workspaceId: string, rootId: string): Promise<string> {
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return page!.id as string;
}

async function seedUser(): Promise<string> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`author-${crypto.randomUUID()}@example.com`}, 'hash', 'Author', ${plan!.id}) RETURNING id
  `;
  return user!.id as string;
}

describe('comment queries', () => {
  test('listCommentIndicators counts a root plus its replies against the root block', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blocka\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();

    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blocka',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await createReply(sql, { workspaceId, pageId, parentId: root.id, authorId, body: 'a reply' });

    const indicators = await listCommentIndicators(sql, { pageId });
    expect(indicators).toEqual([{ blockId: 'blocka', count: 2 }]);
  });

  // A reply carries its own `page_id` alongside `parent_id`, and nothing
  // reconciled the two: `comments_parent_fk` was keyed on
  // `(parent_id, workspace_id)`, which pins the *tenant* and says nothing
  // about the *page*. A reply written with `page_id = A` and a parent
  // rooted on page B inserted cleanly, and `listCommentIndicators` — whose
  // join has no page predicate on the reply side — counted it against
  // page B, a page its author may never have been allowed to read. The
  // parent deliberately lives on a *different* page here; a same-page
  // parent exercises nothing.
  test('a reply cannot join a thread rooted on a different page', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageA = await seedPage(workspaceId, rootId);
    const pageB = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageA, workspaceId, markdown: 'Page A text. ^blockx\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    await savePage(sql, { nodeId: pageB, workspaceId, markdown: 'Page B text. ^blocky\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();

    const rootOnB = await createRootComment(sql, {
      workspaceId,
      pageId: pageB,
      authorId,
      body: 'root on B',
      blockId: 'blocky',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Page',
      quoteHash: 'h',
    });

    expect(await listCommentIndicators(sql, { pageId: pageB })).toEqual([{ blockId: 'blocky', count: 1 }]);

    await expect(
      createReply(sql, { workspaceId, pageId: pageA, parentId: rootOnB.id, authorId, body: 'injected' }),
    ).rejects.toThrow();

    // Page B's indicator count must not have moved: the row is not merely
    // unqueried, it was never writable.
    expect(await listCommentIndicators(sql, { pageId: pageB })).toEqual([{ blockId: 'blocky', count: 1 }]);
  });

  test('listCommentIndicators excludes orphaned threads', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockb\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blockb',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await sql`UPDATE comments SET status = 'orphaned' WHERE id = ${root.id}`;

    const indicators = await listCommentIndicators(sql, { pageId });
    expect(indicators).toEqual([]);
  });

  test('setThreadResolved marks and unmarks a root thread only', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockc\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blockc',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });

    const resolvedOk = await setThreadResolved(sql, { threadId: root.id, workspaceId, resolved: true, resolvedBy: authorId });
    expect(resolvedOk).toBe(true);
    let [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${root.id}`;
    expect(row!.resolved_at).not.toBeNull();

    const unresolvedOk = await setThreadResolved(sql, { threadId: root.id, workspaceId, resolved: false, resolvedBy: authorId });
    expect(unresolvedOk).toBe(true);
    [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${root.id}`;
    expect(row!.resolved_at).toBeNull();
  });

  test('a resolved thread persists across a later reconciliation-triggering save', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    const first = await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockd\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blockd',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await setThreadResolved(sql, { threadId: root.id, workspaceId, resolved: true, resolvedBy: authorId });

    // In-place edit, same anchor, same id — reconciliation runs but does not touch resolution.
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some other text. ^blockd\n', expectedContentHash: first.contentHash, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${root.id}`;
    expect(row!.resolved_at).not.toBeNull();
  });
});

// comment-threads spec: "Threads And Resolution State" / comment-overlay's
// thread panel — the reader `comments_thread_idx ON (parent_id, created_at)`
// was built for.
describe('listCommentThreads', () => {
  // Deliberately a root with zero replies: an implementation that only
  // returns something when a JOIN against a reply row succeeds (e.g. an
  // INNER JOIN instead of LEFT JOIN) would pass every other test here and
  // still drop every unreplied thread — the common case — silently.
  test('a root with no replies is still returned, with an empty replies array', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blocke\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'lonely root',
      blockId: 'blocke',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });

    const threads = await listCommentThreads(sql, { pageId });

    expect(threads).toHaveLength(1);
    expect(threads[0]!.id).toBe(root.id);
    expect(threads[0]!.replies).toEqual([]);
  });

  test('replies nest under their root, ordered by creation time', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockf\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'root',
      blockId: 'blockf',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    const first = await createReply(sql, { workspaceId, pageId, parentId: root.id, authorId, body: 'first reply' });
    const second = await createReply(sql, { workspaceId, pageId, parentId: root.id, authorId, body: 'second reply' });

    const threads = await listCommentThreads(sql, { pageId });

    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((reply) => reply.id)).toEqual([first.id, second.id]);
    expect(threads[0]!.replies.map((reply) => reply.body)).toEqual(['first reply', 'second reply']);
  });

  test('carries the author display name, not just the id', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockg\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'root',
      blockId: 'blockg',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });

    const [thread] = await listCommentThreads(sql, { pageId });

    expect(thread!.authorId).toBe(authorId);
    expect(thread!.authorDisplayName).toBe('Author');
  });

  test('an anchored thread reports orphaned:false and carries its anchor', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockh\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'root',
      blockId: 'blockh',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });

    const [thread] = await listCommentThreads(sql, { pageId });

    expect(thread!.orphaned).toBe(false);
    expect(thread!.blockId).toBe('blockh');
    expect(thread!.quote).toBe('Some');
  });

  // comment-threads spec: "Orphan Is A First-Class State" — an orphaned
  // thread still carries its captured excerpt (quote), not a hole where the
  // anchor used to be.
  test('an orphaned thread reports orphaned:true and still carries its captured excerpt', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blocki\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'root',
      blockId: 'blocki',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await sql`UPDATE comments SET status = 'orphaned' WHERE id = ${root.id}`;

    const [thread] = await listCommentThreads(sql, { pageId });

    expect(thread!.orphaned).toBe(true);
    expect(thread!.quote).toBe('Some');
  });

  test('resolution state is carried on the thread', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockj\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'root',
      blockId: 'blockj',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await setThreadResolved(sql, { threadId: root.id, workspaceId, resolved: true, resolvedBy: authorId });

    const [thread] = await listCommentThreads(sql, { pageId });

    expect(thread!.resolved).toBe(true);
    expect(thread!.resolvedAt).not.toBeNull();
  });

  // Threads live on the queried page only — a root on a different page must
  // never appear, mirroring listCommentIndicators's own page scoping.
  test('a thread on a different page is not returned', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageA = await seedPage(workspaceId, rootId);
    const pageB = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageA, workspaceId, markdown: 'Page A. ^blockk\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    await savePage(sql, { nodeId: pageB, workspaceId, markdown: 'Page B. ^blockl\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const authorId = await seedUser();
    await createRootComment(sql, {
      workspaceId,
      pageId: pageB,
      authorId,
      body: 'root on B',
      blockId: 'blockl',
      offsetStart: 0,
      offsetEnd: 6,
      quote: 'Page B',
      quoteHash: 'h',
    });

    const threads = await listCommentThreads(sql, { pageId: pageA });

    expect(threads).toEqual([]);
  });

  test('a page with no threads returns an empty array', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text.\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });

    const threads = await listCommentThreads(sql, { pageId });

    expect(threads).toEqual([]);
  });
});

/**
 * The workspace dashboard's "threads for you" column: the open threads
 * across a workspace that a person is part of — started, replied to, or
 * named in — with enough about each to say whether it is waiting on them.
 */
describe('listOpenThreadsForUser', () => {
  async function seedNamedUser(displayName: string): Promise<string> {
    const [user] = await sql`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${`${displayName.toLowerCase()}-${crypto.randomUUID()}@example.com`}, 'hash', ${displayName}) RETURNING id
    `;
    return user!.id as string;
  }

  async function seedThread(workspaceId: string, pageId: string, authorId: string, body: string): Promise<string> {
    const root = await createRootComment(sql, { workspaceId, pageId, authorId, body, blockId: 'blocka', offsetStart: 0, offsetEnd: 4, quote: 'Some', quoteHash: 'h' });
    return root.id;
  }

  test('returns open threads the user started, replied to, or is named in — and nothing else', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blocka\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const ana = await seedNamedUser('Ana Ruiz');
    const bo = await seedNamedUser('Bo');

    const started = await seedThread(workspaceId, pageId, ana, 'I started this');
    const repliedTo = await seedThread(workspaceId, pageId, bo, 'Bo started this');
    await createReply(sql, { workspaceId, pageId, parentId: repliedTo, authorId: ana, body: 'Ana replied' });
    const named = await seedThread(workspaceId, pageId, bo, 'What do you think, @Ana Ruiz?');
    await seedThread(workspaceId, pageId, bo, 'Nothing to do with Ana');

    const threads = await listOpenThreadsForUser(sql, { workspaceId, userId: ana, displayName: 'Ana Ruiz', limit: 10 });

    expect(threads.map((thread) => thread.id).sort()).toEqual([started, repliedTo, named].sort());
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    expect(byId.get(named)!.mentioned).toBe(true);
    expect(byId.get(named)!.participating).toBe(false);
    expect(byId.get(repliedTo)!.participating).toBe(true);
    expect(byId.get(repliedTo)!.replyCount).toBe(1);
    // Bo's thread was last touched by Ana's reply, so it is not waiting on her; Bo's question is.
    expect(byId.get(repliedTo)!.lastAuthorId).toBe(ana);
    expect(byId.get(named)!.lastAuthorId).toBe(bo);
    expect(byId.get(named)!.pageTitle).toBe('Page');
    expect(byId.get(named)!.authorDisplayName).toBe('Bo');
  });

  test('a resolved thread is not returned, and the list is newest activity first, capped by `limit`', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blocka\n', expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
    const ana = await seedNamedUser('Ana');

    const older = await seedThread(workspaceId, pageId, ana, 'older');
    const resolved = await seedThread(workspaceId, pageId, ana, 'resolved');
    await setThreadResolved(sql, { threadId: resolved, workspaceId, resolved: true, resolvedBy: ana });
    const newer = await seedThread(workspaceId, pageId, ana, 'newer');
    // A reply is activity: it lifts the older thread above the newer one.
    await createReply(sql, { workspaceId, pageId, parentId: older, authorId: ana, body: 'bump' });

    const threads = await listOpenThreadsForUser(sql, { workspaceId, userId: ana, displayName: 'Ana', limit: 10 });
    expect(threads.map((thread) => thread.id)).toEqual([older, newer]);
    expect(threads[0]!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(threads[1]!.lastActivityAt.getTime());

    const capped = await listOpenThreadsForUser(sql, { workspaceId, userId: ana, displayName: 'Ana', limit: 1 });
    expect(capped.map((thread) => thread.id)).toEqual([older]);
  });
});

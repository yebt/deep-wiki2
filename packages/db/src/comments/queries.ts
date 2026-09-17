/**
 * Comment queries behind `packages/db/src/comments/` (comment-threads,
 * comment-overlay specs). `reconcile-comments.ts` and `resolve-changeset.ts`
 * own the save-time reconciliation and changeset arbitration respectively;
 * this module is the ordinary CRUD surface `apps/api`'s routes call.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface CommentIndicator {
  readonly blockId: string;
  readonly count: number;
}

export interface ListCommentIndicatorsInput {
  readonly pageId: string;
}

/**
 * One row per anchored root comment's block, with its reply-inclusive
 * count (comment-overlay spec: "A subject with comment receives real
 * indicators"). Only `status = 'anchored'` roots are counted — an orphaned
 * thread has no block to indicate against.
 */
export async function listCommentIndicators(sql: SqlExecutor, input: ListCommentIndicatorsInput): Promise<CommentIndicator[]> {
  const rows = await sql<{ block_id: string; count: string }[]>`
    SELECT root.block_id, (1 + COUNT(reply.id))::text AS count
      FROM comments root
      JOIN live_nodes ln ON ln.id = root.page_id
      LEFT JOIN comments reply ON reply.parent_id = root.id
     WHERE root.page_id = ${input.pageId} AND root.parent_id IS NULL AND root.status = 'anchored'
     GROUP BY root.id, root.block_id
  `;

  const byBlock = new Map<string, number>();
  for (const row of rows) {
    byBlock.set(row.block_id, (byBlock.get(row.block_id) ?? 0) + Number(row.count));
  }
  return [...byBlock.entries()].map(([blockId, count]) => ({ blockId, count }));
}

export interface CreateRootCommentInput {
  readonly workspaceId: string;
  readonly pageId: string;
  readonly authorId: string;
  readonly body: string;
  readonly blockId: string;
  readonly offsetStart: number;
  readonly offsetEnd: number;
  readonly quote: string;
  readonly quoteHash: string;
}

export interface CreatedComment {
  readonly id: string;
}

/** Creates a new thread — a root comment carrying the anchor (comment-threads spec: "A Comment Captures Its Own Excerpt At Creation"). */
export async function createRootComment(sql: SqlExecutor, input: CreateRootCommentInput): Promise<CreatedComment> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO comments (workspace_id, page_id, author_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
    VALUES (
      ${input.workspaceId}, ${input.pageId}, ${input.authorId}, ${input.body},
      ${input.blockId}, ${input.offsetStart}, ${input.offsetEnd}, ${input.quote}, ${input.quoteHash}, 'anchored'
    )
    RETURNING id
  `;
  return { id: row!.id };
}

export interface CreateReplyInput {
  readonly workspaceId: string;
  readonly pageId: string;
  readonly parentId: string;
  readonly authorId: string;
  readonly body: string;
}

/**
 * A reply joins the existing thread (comment-threads spec) — no anchor of
 * its own, enforced by `comments_root_has_anchor`.
 *
 * `pageId` here is not advisory: `comments_parent_fk` is keyed on
 * `(parent_id, page_id, workspace_id)` (0015), so a reply whose page
 * disagrees with its parent's has no referenced row and is rejected by the
 * database. That is deliberate — `listCommentIndicators` below, and any
 * future thread-read endpoint, attribute a reply to its *root's* page, a
 * narrower scope than the tenant the old two-column key constrained.
 */
export async function createReply(sql: SqlExecutor, input: CreateReplyInput): Promise<CreatedComment> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO comments (workspace_id, page_id, parent_id, author_id, body)
    VALUES (${input.workspaceId}, ${input.pageId}, ${input.parentId}, ${input.authorId}, ${input.body})
    RETURNING id
  `;
  return { id: row!.id };
}

export interface CommentThreadReply {
  readonly id: string;
  readonly body: string;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  readonly createdAt: Date;
}

export interface CommentThreadRoot {
  readonly id: string;
  readonly body: string;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  readonly createdAt: Date;
  readonly blockId: string;
  readonly offsetStart: number;
  readonly offsetEnd: number;
  readonly quote: string;
  readonly orphaned: boolean;
  readonly resolved: boolean;
  readonly resolvedAt: Date | null;
  readonly replies: readonly CommentThreadReply[];
}

export interface ListCommentThreadsInput {
  readonly pageId: string;
}

interface RootRow {
  id: string;
  body: string;
  author_id: string | null;
  author_display_name: string | null;
  created_at: Date;
  block_id: string;
  offset_start: number;
  offset_end: number;
  quote: string;
  status: string | null;
  resolved_at: Date | null;
}

interface ReplyRow {
  id: string;
  parent_id: string;
  body: string;
  author_id: string | null;
  author_display_name: string | null;
  created_at: Date;
}

/**
 * Threads and replies for a page (comment-threads spec: "Threads And
 * Resolution State"; comment-overlay spec's gutter/thread panel). Two
 * queries, not one per thread: roots for the page, then every reply whose
 * `parent_id` names one of those roots in a single `= ANY(...)` lookup —
 * exactly the access `comments_thread_idx ON (parent_id, created_at)` was
 * built for. A reply's own `page_id` is not re-checked here:
 * `comments_parent_fk` (migration 0015) already makes a cross-page reply
 * unrepresentable, so every reply returned by the second query is
 * guaranteed to belong to a root already scoped to `input.pageId`.
 *
 * Only display name (never email) reaches the response, matching
 * `listPageRevisions`'s own author shape.
 */
export async function listCommentThreads(sql: SqlExecutor, input: ListCommentThreadsInput): Promise<CommentThreadRoot[]> {
  const roots = await sql<RootRow[]>`
    SELECT c.id, c.body, c.author_id, u.display_name AS author_display_name, c.created_at,
           c.block_id, c.offset_start, c.offset_end, c.quote, c.status, c.resolved_at
      FROM comments c
      JOIN live_nodes ln ON ln.id = c.page_id
      LEFT JOIN users u ON u.id = c.author_id
     WHERE c.page_id = ${input.pageId} AND c.parent_id IS NULL
     ORDER BY c.created_at ASC
  `;
  if (roots.length === 0) return [];

  const rootIds = roots.map((row) => row.id);
  const replies = await sql<ReplyRow[]>`
    SELECT c.id, c.parent_id, c.body, c.author_id, u.display_name AS author_display_name, c.created_at
      FROM comments c
      LEFT JOIN users u ON u.id = c.author_id
     WHERE c.parent_id = ANY(${rootIds})
     ORDER BY c.parent_id, c.created_at ASC
  `;

  const repliesByRoot = new Map<string, CommentThreadReply[]>();
  for (const reply of replies) {
    const list = repliesByRoot.get(reply.parent_id) ?? [];
    list.push({
      id: reply.id,
      body: reply.body,
      authorId: reply.author_id,
      authorDisplayName: reply.author_display_name,
      createdAt: reply.created_at,
    });
    repliesByRoot.set(reply.parent_id, list);
  }

  return roots.map((root) => ({
    id: root.id,
    body: root.body,
    authorId: root.author_id,
    authorDisplayName: root.author_display_name,
    createdAt: root.created_at,
    blockId: root.block_id,
    offsetStart: root.offset_start,
    offsetEnd: root.offset_end,
    quote: root.quote,
    orphaned: root.status === 'orphaned',
    resolved: root.resolved_at !== null,
    resolvedAt: root.resolved_at,
    replies: repliesByRoot.get(root.id) ?? [],
  }));
}

export interface SetThreadResolvedInput {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly resolved: boolean;
  readonly resolvedBy: string;
}

/** Settable by a subject with `comment` (comment-threads spec: "Threads And Resolution State"). Persists across later reconciliation — resolution is orthogonal to the anchor. */
export async function setThreadResolved(sql: SqlExecutor, input: SetThreadResolvedInput): Promise<boolean> {
  const rows = input.resolved
    ? await sql`
        UPDATE comments SET resolved_at = now(), resolved_by = ${input.resolvedBy}
         WHERE id = ${input.threadId} AND workspace_id = ${input.workspaceId} AND parent_id IS NULL
        RETURNING id
      `
    : await sql`
        UPDATE comments SET resolved_at = NULL, resolved_by = NULL
         WHERE id = ${input.threadId} AND workspace_id = ${input.workspaceId} AND parent_id IS NULL
        RETURNING id
      `;
  return rows.length === 1;
}

export interface UserThreadSummary {
  readonly id: string;
  readonly pageId: string;
  readonly pageTitle: string;
  readonly body: string;
  readonly quote: string;
  readonly orphaned: boolean;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  readonly createdAt: Date;
  readonly replyCount: number;
  /** The root's own `created_at`, or the newest reply's. */
  readonly lastActivityAt: Date;
  /** Who wrote the newest message in the thread — the root's author when there are no replies. */
  readonly lastAuthorId: string | null;
  /** The user started the thread or replied in it. */
  readonly participating: boolean;
  /** Some message in the thread names the user (`@<display name>`). */
  readonly mentioned: boolean;
}

export interface ListOpenThreadsForUserInput {
  readonly workspaceId: string;
  readonly userId: string;
  /** The user's current `users.display_name`; a thread that writes `@<this>` is one that names them. */
  readonly displayName: string;
  readonly limit: number;
}

interface UserThreadRow {
  id: string;
  page_id: string;
  page_title: string;
  body: string;
  quote: string;
  status: string | null;
  author_id: string | null;
  author_display_name: string | null;
  created_at: Date;
  reply_count: string | number;
  last_activity_at: Date;
  last_author_id: string | null;
  participating: boolean;
  mentioned: boolean;
}

/**
 * The open threads across a workspace that concern one person — the
 * dashboard's "threads for you". A thread concerns them when they started
 * it, replied in it, or a message in it writes their name after an `@`.
 * Comments carry no structured mentions today, so the name match is a
 * plain-text convention and is labelled as such where it renders. It is a
 * `strpos` over the bodies of one workspace's open roots and their
 * replies — a bounded scan by nature, not an indexable prefix predicate,
 * and stated as one rather than dressed as a `LIKE`.
 * Newest activity first, where activity is the root or its newest reply.
 *
 * Per-page non-disclosure is the route's job: every matching thread in
 * the workspace is returned, and `apps/api` keeps only those on pages the
 * caller may `comment` on — the same gate `GET /pages/:id/comments` uses.
 */
export async function listOpenThreadsForUser(sql: SqlExecutor, input: ListOpenThreadsForUserInput): Promise<UserThreadSummary[]> {
  const mention = `@${input.displayName}`;
  const rows = await sql<UserThreadRow[]>`
    SELECT c.id, c.page_id, n.title AS page_title, c.body, c.quote, c.status,
           c.author_id, u.display_name AS author_display_name, c.created_at,
           activity.reply_count, activity.last_activity_at, activity.last_author_id,
           (c.author_id = ${input.userId} OR activity.replied) AS participating,
           (strpos(c.body, ${mention}) > 0 OR activity.mentioned) AS mentioned
      FROM comments c
      JOIN live_nodes n ON n.id = c.page_id AND n.workspace_id = c.workspace_id
      LEFT JOIN users u ON u.id = c.author_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS reply_count,
               coalesce(max(r.created_at), c.created_at) AS last_activity_at,
               coalesce((SELECT r2.author_id FROM comments r2 WHERE r2.parent_id = c.id ORDER BY r2.created_at DESC LIMIT 1), c.author_id) AS last_author_id,
               bool_or(r.author_id = ${input.userId}) AS replied,
               bool_or(strpos(r.body, ${mention}) > 0) AS mentioned
          FROM comments r
         WHERE r.parent_id = c.id
      ) activity
     WHERE c.workspace_id = ${input.workspaceId}
       AND c.parent_id IS NULL
       AND c.resolved_at IS NULL
       AND (c.author_id = ${input.userId} OR activity.replied OR strpos(c.body, ${mention}) > 0 OR activity.mentioned)
     ORDER BY activity.last_activity_at DESC, c.id DESC
     LIMIT ${input.limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    pageId: row.page_id,
    pageTitle: row.page_title,
    body: row.body,
    quote: row.quote,
    orphaned: row.status === 'orphaned',
    authorId: row.author_id,
    authorDisplayName: row.author_display_name,
    createdAt: row.created_at,
    replyCount: Number(row.reply_count),
    lastActivityAt: row.last_activity_at,
    lastAuthorId: row.last_author_id,
    participating: row.participating === true,
    mentioned: row.mentioned === true,
  }));
}

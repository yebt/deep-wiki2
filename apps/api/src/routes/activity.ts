/**
 * `GET /workspaces/:id/activity` — what the workspace dashboard opens on:
 * "what changed and who is here" (apps/web/PRODUCT.md). The smallest
 * honest read for a screen no existing endpoint could feed: `/books/:id/
 * history` is one book, `/pages/:id/comments` is one page, and a dashboard
 * is the whole workspace at once. Who is *here* is not in this response —
 * that is the presence stream's, already workspace-scoped.
 *
 * Three lists, three gates, one rule from `tree.ts`:
 *
 * - The workspace itself: a caller who can read nothing in it gets the
 *   same 404 a workspace that never existed produces — `readableWorkspaceIds`
 *   is the gate `GET /workspaces/:id/tree` uses, from the same call site.
 * - `recent` and `mine`: every save in the workspace, filtered by
 *   `readableResourceIds` before a page's title or the fact of its change
 *   can reach the body — the split `revisions.ts` already uses for a book.
 * - `threads`: filtered by `canManyResources(action: 'comment')`, the gate
 *   `GET /pages/:id/comments` uses, so a caller with `read` but not
 *   `comment` sees the empty list a page with no threads produces.
 *
 * Each recent change carries the four block-diff class counts (block-diff
 * spec), computed here from the revision's own `content` and the content it
 * replaced — never from a stored index (`scripts/checks/diff-input-purity.ts`
 * enforces this structurally). A page's first save diffs against nothing,
 * so it reads as "everything added", which is what it was.
 *
 * The queries over-fetch by a fixed margin and the route trims after
 * filtering: a caller who may read a third of a busy workspace still gets
 * a full column, and the count of what was dropped never reaches them.
 */
import { WorkspaceActivityResponseSchema, ErrorResponseSchema } from '@deep-wiki/contracts';
import {
  canManyResources,
  listOpenThreadsForUser,
  listWorkspaceRevisions,
  readableResourceIds,
  readableWorkspaceIds,
} from '@deep-wiki/db';
import { diffBlocks } from '@deep-wiki/markdown';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';
import { resolveWorkspaceId } from './workspace-ref';

export interface ActivityRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
}

/** How many rows each column shows. */
const RECENT_LIMIT = 20;
const MINE_LIMIT = 10;
const THREADS_LIMIT = 20;
/** How far past each limit the query reaches, so per-page filtering still fills the column. */
const OVERFETCH = 3;

interface WorkspaceRow {
  name: string;
  slug: string;
}

interface UserRow {
  display_name: string;
}

function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
}

function classCounts(before: string | null, after: string): { added: number; removed: number; modified: number; moved: number } {
  const counts = { added: 0, removed: 0, modified: 0, moved: 0 };
  for (const change of diffBlocks(before ?? '', after).changes) {
    if (change.kind === 'added' || change.kind === 'removed' || change.kind === 'modified' || change.kind === 'moved') {
      counts[change.kind] += 1;
    }
  }
  return counts;
}

export function createActivityRoutes(deps: ActivityRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  app.get('/workspaces/:id/activity', auth, async (c) => {
    // By id or by slug (`workspace-ref.ts`): the dashboard asks by the slug
    // its address carries. Identity first, then the same gate as by id.
    const workspaceId = await resolveWorkspaceId(deps.sql, c.req.param('id'));
    if (!workspaceId) return notFound(c);
    const session = c.get('session');
    const subject = { subjectType: 'user' as const, subjectId: session.userId };

    const readableWorkspaces = await readableWorkspaceIds(deps.sql, subject);
    if (!readableWorkspaces.has(workspaceId)) return notFound(c);

    const [workspace] = await deps.sql<WorkspaceRow[]>`SELECT name, slug FROM workspaces WHERE id = ${workspaceId}`;
    if (!workspace) return notFound(c);
    const [user] = await deps.sql<UserRow[]>`SELECT display_name FROM users WHERE id = ${session.userId}`;

    const [recentRows, mineRows, threadRows] = await Promise.all([
      listWorkspaceRevisions(deps.sql, { workspaceId, limit: RECENT_LIMIT * OVERFETCH }),
      listWorkspaceRevisions(deps.sql, { workspaceId, limit: MINE_LIMIT * OVERFETCH, authorId: session.userId }),
      listOpenThreadsForUser(deps.sql, {
        workspaceId,
        userId: session.userId,
        displayName: user?.display_name ?? '',
        limit: THREADS_LIMIT * OVERFETCH,
      }),
    ]);

    const [readablePages, commentablePages] = await Promise.all([
      readableResourceIds(deps.sql, {
        workspaceId,
        ...subject,
        resourceIds: [...new Set([...recentRows, ...mineRows].map((row) => row.pageId))],
      }),
      canManyResources(deps.sql, {
        workspaceId,
        ...subject,
        action: 'comment',
        resourceIds: [...new Set(threadRows.map((thread) => thread.pageId))],
      }),
    ]);

    const recent = recentRows
      .filter((row) => readablePages.has(row.pageId))
      .slice(0, RECENT_LIMIT)
      .map((row) => ({
        revisionId: row.id,
        pageId: row.pageId,
        pageTitle: row.pageTitle,
        author: { id: row.authorId, displayName: row.authorDisplayName },
        createdAt: row.createdAt.toISOString(),
        changes: classCounts(row.previousContent, row.content),
      }));

    const mine = mineRows
      .filter((row) => readablePages.has(row.pageId))
      .slice(0, MINE_LIMIT)
      .map((row) => ({ revisionId: row.id, pageId: row.pageId, pageTitle: row.pageTitle, createdAt: row.createdAt.toISOString() }));

    const threads = threadRows
      .filter((thread) => commentablePages.has(thread.pageId))
      .slice(0, THREADS_LIMIT)
      .map((thread) => ({
        id: thread.id,
        pageId: thread.pageId,
        pageTitle: thread.pageTitle,
        quote: thread.quote,
        orphaned: thread.orphaned,
        author: { id: thread.authorId, displayName: thread.authorDisplayName },
        replyCount: thread.replyCount,
        lastActivityAt: thread.lastActivityAt.toISOString(),
        mentionsYou: thread.mentioned,
        awaitsYou: thread.lastAuthorId !== session.userId,
      }));

    return c.json(
      WorkspaceActivityResponseSchema.parse({
        workspace: { id: workspaceId, name: workspace.name, slug: workspace.slug },
        recent,
        mine,
        threads,
      }),
    );
  });

  return app;
}

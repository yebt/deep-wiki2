/**
 * `GET /pages/:id/history` (revision-history spec: "Page History Query
 * Returns Revisions Newest First"). Absence and denial-of-read share one
 * response, the same shape `comments.ts`/`mentions.ts` already use: a
 * caller with no grant cannot tell "this page does not exist" from "this
 * page exists and you may not see it".
 */
import { can, listBookHistory, listPageRevisions, readableResourceIds } from '@deep-wiki/db';
import { BookHistoryResponseSchema, ErrorResponseSchema, PageHistoryResponseSchema } from '@deep-wiki/contracts';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface RevisionRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
}

interface NodeRow {
  workspace_id: string;
}

function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
}

export function createRevisionRoutes(deps: RevisionRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  app.get('/pages/:id/history', auth, async (c) => {
    const pageId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${pageId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    const revisions = await listPageRevisions(deps.sql, { pageId, workspaceId: node.workspace_id });

    return c.json(
      PageHistoryResponseSchema.parse({
        revisions: revisions.map((revision) => ({
          id: revision.id,
          authorId: revision.authorId,
          authorDisplayName: revision.authorDisplayName,
          createdAt: revision.createdAt.toISOString(),
          changesetId: revision.changesetId,
        })),
      }),
    );
  });

  // changesets spec: "Book-Level History Is One Query" — the input the
  // book-level diff screen needs. `resolveBookId`'s ancestor walk at save
  // time already scoped every changeset's `book_id` to the nearest book
  // ancestor, so a page nested under a chapter still surfaces here through
  // the ordinary `changeset.book_id = <this book>` predicate. Per-page
  // non-disclosure — a reader who can read the book but not one page in it
  // must not see that page's revisions — is enforced here exactly the way
  // `tree.ts` drops unreadable descendants: filtered through
  // `readableResourceIds`, never a `can()` loop, and a changeset left with
  // no readable revisions is dropped entirely rather than shown empty.
  app.get('/books/:id/history', auth, async (c) => {
    const bookId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${bookId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: bookId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    const changesets = await listBookHistory(deps.sql, { bookId, workspaceId: node.workspace_id });
    const allPageIds = [...new Set(changesets.flatMap((changeset) => changeset.revisions.map((revision) => revision.pageId)))];
    const readablePageIds = await readableResourceIds(deps.sql, {
      workspaceId: node.workspace_id,
      subjectType: 'user',
      subjectId: session.userId,
      resourceIds: allPageIds,
    });

    const visible = changesets
      .map((changeset) => ({
        ...changeset,
        revisions: changeset.revisions.filter((revision) => readablePageIds.has(revision.pageId)),
      }))
      .filter((changeset) => changeset.revisions.length > 0);

    return c.json(
      BookHistoryResponseSchema.parse({
        changesets: visible.map((changeset) => ({
          id: changeset.id,
          authorId: changeset.authorId,
          authorDisplayName: changeset.authorDisplayName,
          message: changeset.message,
          windowStart: changeset.windowStart.toISOString(),
          windowEnd: changeset.windowEnd.toISOString(),
          revisions: changeset.revisions.map((revision) => ({
            id: revision.id,
            pageId: revision.pageId,
            createdAt: revision.createdAt.toISOString(),
          })),
        })),
      }),
    );
  });

  return app;
}

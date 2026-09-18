/**
 * `GET /pages/:id/history` (revision-history spec: "Page History Query
 * Returns Revisions Newest First"). Absence and denial-of-read share one
 * response, the same shape `comments.ts`/`mentions.ts` already use: a
 * caller with no grant cannot tell "this page does not exist" from "this
 * page exists and you may not see it".
 */
import { can, canManyResources, listBookDeletions, listBookHistory, listPageRevisions, readableResourceIds } from '@deep-wiki/db';
import { BookHistoryResponseSchema, ErrorResponseSchema, PageHistoryResponseSchema } from '@deep-wiki/contracts';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface RevisionRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
}

/** A node with its workspace's slug — what every response here names beside the id (`NodeWorkspaceSchema`). */
interface NodeRow {
  workspace_id: string;
  workspace_slug: string;
}

interface NodeWithTitleRow extends NodeRow {
  title: string;
}

function workspaceOf(node: NodeRow): { id: string; slug: string } {
  return { id: node.workspace_id, slug: node.workspace_slug };
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

    const [node] = await deps.sql<NodeRow[]>`
      SELECT n.workspace_id, w.slug AS workspace_slug FROM live_nodes n JOIN workspaces w ON w.id = n.workspace_id WHERE n.id = ${pageId}
    `;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    const revisions = await listPageRevisions(deps.sql, { pageId, workspaceId: node.workspace_id });

    return c.json(
      PageHistoryResponseSchema.parse({
        workspace: workspaceOf(node),
        revisions: revisions.map((revision) => ({
          id: revision.id,
          authorId: revision.authorId,
          authorDisplayName: revision.authorDisplayName,
          createdAt: revision.createdAt.toISOString(),
          changesetId: revision.changesetId,
          contentHash: revision.contentHash,
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

    const [node] = await deps.sql<NodeWithTitleRow[]>`
      SELECT n.workspace_id, n.title, w.slug AS workspace_slug FROM live_nodes n JOIN workspaces w ON w.id = n.workspace_id WHERE n.id = ${bookId}
    `;
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

    // changesets spec: "History Response Carries Deletions Alongside
    // Changesets"; deletion-trace spec — "A Restricted Trace Discloses Only
    // That A Page Was Deleted To A Subject Who Could Not Have Read It"
    // (design.md Decision 5, "Disclosure"). A `restricted` row is filtered
    // through `canManyResources(read)` on `node_id` while the row still
    // physically exists — the permission resolver walks the base `nodes`
    // table regardless of `trashed_at`, so this already covers a trashed
    // node correctly; once the node is purged, `canManyResources` can no
    // longer resolve it (its own ancestor CTE anchors on the row existing),
    // so `manage` on the book is the fallback for that case.
    const deletionRows = await listBookDeletions(deps.sql, { bookId, workspaceId: node.workspace_id });
    const restrictedNodeIds = [...new Set(deletionRows.filter((row) => row.restricted).map((row) => row.nodeId))];
    const [readableRestrictedIds, hasManageOnBook] = await Promise.all([
      canManyResources(deps.sql, {
        workspaceId: node.workspace_id,
        subjectType: 'user',
        subjectId: session.userId,
        action: 'read',
        resourceIds: restrictedNodeIds,
      }),
      can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: bookId, action: 'manage' }),
    ]);
    const deletions = deletionRows.map((row) => {
      const visibleDetail = !row.restricted || readableRestrictedIds.has(row.nodeId) || hasManageOnBook;
      return {
        id: row.id,
        event: row.event,
        nodeType: row.nodeType,
        title: visibleDetail ? row.title : null,
        actorDisplayName: visibleDetail ? row.actorDisplayName : null,
        occurredAt: row.occurredAt.toISOString(),
        restricted: row.restricted,
      };
    });

    return c.json(
      BookHistoryResponseSchema.parse({
        title: node.title,
        workspaceId: node.workspace_id,
        workspace: workspaceOf(node),
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
        deletions,
      }),
    );
  });

  return app;
}

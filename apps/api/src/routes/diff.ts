/**
 * `GET /pages/:id/diff?from=&to=` and `GET /books/:id/diff?since=`
 * (block-diff spec). Both call `diffBlocks()` against the two revisions'
 * own stored `content` — never `block_index` — and both are gated by
 * `can('read')`; absence and denial-of-read share one response, the same
 * shape `comments.ts`/`revisions.ts` already use.
 */
import { can, getRevisionsByIds, listChangedPagesSince, readableResourceIds } from '@deep-wiki/db';
import { ErrorResponseSchema, PageDiffResponseSchema } from '@deep-wiki/contracts';
import { diffBlocks, parse, sliceBlocks } from '@deep-wiki/markdown';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { attachBlockText } from './attach-block-text';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface DiffRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
}

interface NodeRow {
  workspace_id: string;
}

function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
}

export function createDiffRoutes(deps: DiffRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  app.get('/pages/:id/diff', auth, async (c) => {
    const pageId = c.req.param('id');
    const session = c.get('session');
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (!from || !to) return c.json(ErrorResponseSchema.parse({ error: 'from and to are required' }), 400);

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${pageId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    const revisions = await getRevisionsByIds(deps.sql, { workspaceId: node.workspace_id, ids: [from, to] });
    const fromRevision = revisions.find((revision) => revision.id === from && revision.pageId === pageId);
    const toRevision = revisions.find((revision) => revision.id === to && revision.pageId === pageId);
    if (!fromRevision || !toRevision) return notFound(c);

    const diff = diffBlocks(fromRevision.content, toRevision.content);
    // `diffBlocks()` reports classification only (design.md Decision 2);
    // the diff view has nothing to render without each change's own text,
    // looked up from the same two sides rather than re-parsed a third
    // time.
    const beforeSlices = sliceBlocks(parse(fromRevision.content), fromRevision.content);
    const afterSlices = sliceBlocks(parse(toRevision.content), toRevision.content);
    const changes = attachBlockText(diff.changes, beforeSlices, afterSlices);

    return c.json(
      PageDiffResponseSchema.parse({
        diff: {
          from: { id: fromRevision.id, createdAt: fromRevision.createdAt.toISOString() },
          to: { id: toRevision.id, createdAt: toRevision.createdAt.toISOString() },
          changes,
        },
      }),
    );
  });

  // block-diff spec: "Book-Level Diff Aggregates Changed Pages Since A
  // Date" — a caller may hold `read` on the book without holding it on
  // every page beneath it; filtered through `readableResourceIds`
  // (design.md "Listing without disclosure"), never a `can()` loop.
  app.get('/books/:id/diff', auth, async (c) => {
    const bookId = c.req.param('id');
    const session = c.get('session');
    const since = c.req.query('since');
    if (!since) return c.json(ErrorResponseSchema.parse({ error: 'since is required' }), 400);
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) return c.json(ErrorResponseSchema.parse({ error: 'since must be a valid date' }), 400);

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${bookId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: bookId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    const changed = await listChangedPagesSince(deps.sql, { workspaceId: node.workspace_id, bookId, since: sinceDate });
    const readable = await readableResourceIds(deps.sql, {
      workspaceId: node.workspace_id,
      subjectType: 'user',
      subjectId: session.userId,
      resourceIds: changed.map((page) => page.pageId),
    });

    const pages: { pageId: string; diff: ReturnType<typeof diffBlocks> }[] = [];
    for (const page of changed.filter((p) => readable.has(p.pageId))) {
      const ids = page.baselineRevisionId ? [page.baselineRevisionId, page.latestRevisionId] : [page.latestRevisionId];
      const revisions = await getRevisionsByIds(deps.sql, { workspaceId: node.workspace_id, ids });
      const latest = revisions.find((r) => r.id === page.latestRevisionId);
      const baseline = page.baselineRevisionId ? revisions.find((r) => r.id === page.baselineRevisionId) : undefined;
      if (!latest) continue; // the revision was pruned meanwhile
      pages.push({ pageId: page.pageId, diff: diffBlocks(baseline?.content ?? '', latest.content) });
    }

    return c.json({ pages });
  });

  return app;
}

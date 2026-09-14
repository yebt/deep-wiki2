/**
 * Comment routes (comment-threads, comment-overlay specs). The indicator
 * endpoint is deliberately distinct from the page-content endpoint and
 * returns the exact same shape whether the subject lacks `comment` or the
 * page genuinely has zero comments — "no evidence a comment exists" is a
 * response-shape guarantee, not merely a missing field. Creation mints a
 * persisted anchor for an unanchored block through the ordinary save
 * transaction, reusing `savePage()` rather than writing `page_content`
 * from a second place.
 */
import { createHash } from 'node:crypto';
import {
  can,
  createReply,
  createRootComment,
  listCommentIndicators,
  readPageMarkdown,
  savePage,
  setThreadResolved,
} from '@deep-wiki/db';
import type { MailSender } from '@deep-wiki/core';
import {
  CommentIndicatorsResponseSchema,
  CreateCommentRequestSchema,
  CreateCommentResponseSchema,
  ErrorResponseSchema,
  SetThreadResolvedRequestSchema,
} from '@deep-wiki/contracts';
import { mintAnchorAtBlock } from '@deep-wiki/markdown';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface CommentRouteDeps {
  readonly sql: postgres.Sql;
  readonly mailSender: MailSender;
  readonly sessionIdleTimeoutMinutes: number;
  readonly changesetWindowMinutes: number;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function quoteHashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

interface NodeRow {
  workspace_id: string;
}

/**
 * Absence and denial-of-read answer with the *same* response object, from
 * the same call site — a caller with no grant cannot distinguish "this page
 * does not exist" from "this page exists and you may not see it". This is
 * the singular analogue of what `can-many.ts`/`readable.ts` already do for
 * sets, where an unreadable id is simply dropped from the result rather
 * than reported as denied, and the same rule the password-reset route
 * holds for account existence.
 *
 * Denial of a *stronger* action (`comment` on a page the caller can already
 * read) still answers 403: that caller can see the page, so the distinction
 * discloses nothing. Read is therefore always the first gate.
 */
function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
}

export function createCommentRoutes(deps: CommentRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  // comment-overlay: "Indicators And Counts Come From A Separate Endpoint
  // Gated By can('comment')". A subject with read but not comment, and a
  // subject on a page with zero comments, both receive `{ indicators: [] }`
  // — the same status code, the same shape, nothing to distinguish them.
  app.get('/pages/:id/comments/indicators', auth, async (c) => {
    const pageId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${pageId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    // `!node` is redundant with `canRead` at runtime and present only so the
    // compiler narrows `node` below; the response is one expression either way.
    if (!node || !canRead) return notFound(c);

    const canComment = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'comment' });
    if (!canComment) {
      return c.json(CommentIndicatorsResponseSchema.parse({ indicators: [] }));
    }

    const indicators = await listCommentIndicators(deps.sql, { pageId });
    return c.json(CommentIndicatorsResponseSchema.parse({ indicators }));
  });

  // comment-overlay: "A Comment On An Unanchored Block Mints And Persists
  // An Anchor". A root comment's blockId may still be a derived id
  // (`d:...#n`) — mintAnchorAtBlock() converts it to a real persisted one
  // through the ordinary save transaction before the comment row exists,
  // so the anchor it names always resolves.
  app.post('/pages/:id/comments', auth, async (c) => {
    const pageId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${pageId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    // `!node` is redundant with `canRead` at runtime and present only so the
    // compiler narrows `node` below; the response is one expression either way.
    if (!node || !canRead) return notFound(c);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'comment' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const body = await readJsonBody(c.req.raw);
    const parsed = CreateCommentRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'invalid request' }), 400);

    let created: { id: string; blockId?: string };

    if (parsed.data.parentId) {
      // The page comes from the URL and the parent from the body, and the
      // gate above only asked about the URL's page. `comments_parent_fk`
      // (0015) makes a cross-page reply unrepresentable, so this lookup
      // cannot be the only guard and is not trying to be — it exists so a
      // parent that does not belong to this page produces the ordinary
      // "not found" answer instead of a constraint violation surfacing as
      // a 500. Scoping it by `page_id` *and* `workspace_id` also makes a
      // parent on another page indistinguishable from a `parentId` that
      // names nothing at all: the caller learns nothing about a thread on
      // a page they cannot read.
      // `parentId` is `z.string()` in the shared contract, so a
      // non-uuid value would make the comparison below a Postgres cast
      // error rather than a miss; it is simply "no such parent here".
      if (!UUID_PATTERN.test(parsed.data.parentId)) return notFound(c);

      const [parent] = await deps.sql<{ id: string }[]>`
        SELECT id FROM comments
         WHERE id = ${parsed.data.parentId}
           AND page_id = ${pageId}
           AND workspace_id = ${node.workspace_id}
      `;
      if (!parent) return notFound(c);

      const reply = await createReply(deps.sql, {
        workspaceId: node.workspace_id,
        pageId,
        parentId: parsed.data.parentId,
        authorId: session.userId,
        body: parsed.data.body,
      });
      created = { id: reply.id };
    } else {
      if (parsed.data.blockId === undefined || parsed.data.quote === undefined || parsed.data.offsetStart === undefined || parsed.data.offsetEnd === undefined) {
        return c.json(ErrorResponseSchema.parse({ error: 'blockId, offsetStart, offsetEnd and quote are required for a new thread' }), 400);
      }

      const content = await readPageMarkdown(deps.sql, { nodeId: pageId, workspaceId: node.workspace_id });
      if (!content) return notFound(c);

      const minted = mintAnchorAtBlock(content.markdown, parsed.data.blockId);
      let resolvedBlockId = parsed.data.blockId;

      if (minted && minted.markdown !== content.markdown) {
        const [currentRow] = await deps.sql<{ content_hash: string }[]>`
          SELECT content_hash FROM page_content WHERE node_id = ${pageId} AND workspace_id = ${node.workspace_id}
        `;
        await savePage(deps.sql, {
          nodeId: pageId,
          workspaceId: node.workspace_id,
          markdown: minted.markdown,
          expectedContentHash: currentRow!.content_hash,
          updatedBy: session.userId,
          changesetWindowMinutes: deps.changesetWindowMinutes,
        });
        resolvedBlockId = minted.blockId;
      } else if (minted) {
        resolvedBlockId = minted.blockId;
      }

      const root = await createRootComment(deps.sql, {
        workspaceId: node.workspace_id,
        pageId,
        authorId: session.userId,
        body: parsed.data.body,
        blockId: resolvedBlockId,
        offsetStart: parsed.data.offsetStart,
        offsetEnd: parsed.data.offsetEnd,
        quote: parsed.data.quote,
        quoteHash: quoteHashOf(parsed.data.quote),
      });
      created = { id: root.id, blockId: resolvedBlockId };
    }

    // comment-threads: "Mention Notifications Go Through MailSender" — a
    // mentioned user without read on the page receives no notification.
    // Explicit, already-resolved ids only; never parsed out of free text.
    for (const mentionedUserId of parsed.data.mentionedUserIds) {
      const mentionedCanRead = await can(deps.sql, {
        subjectType: 'user',
        subjectId: mentionedUserId,
        resourceId: pageId,
        action: 'read',
      });
      if (!mentionedCanRead) continue;

      const [mentioned] = await deps.sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${mentionedUserId}`;
      if (!mentioned) continue;

      await deps.mailSender.send({
        to: mentioned.email,
        subject: 'You were mentioned in a comment',
        body: `Someone mentioned you in a comment: ${parsed.data.body}`,
      });
    }

    return c.json(CreateCommentResponseSchema.parse(created), 201);
  });

  // comment-threads: "Threads And Resolution State" — settable by a
  // subject with `comment`.
  app.patch('/comments/:threadId/resolved', auth, async (c) => {
    const threadId = c.req.param('threadId');
    const session = c.get('session');

    const [thread] = await deps.sql<{ workspace_id: string; page_id: string }[]>`
      SELECT workspace_id, page_id FROM comments WHERE id = ${threadId} AND parent_id IS NULL
    `;
    const canRead =
      thread !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: thread.page_id, action: 'read' }));
    if (!thread || !canRead) return notFound(c);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: thread.page_id, action: 'comment' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const body = await readJsonBody(c.req.raw);
    const parsed = SetThreadResolvedRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'resolved (boolean) is required' }), 400);

    const ok = await setThreadResolved(deps.sql, {
      threadId,
      workspaceId: thread.workspace_id,
      resolved: parsed.data.resolved,
      resolvedBy: session.userId,
    });
    if (!ok) return notFound(c);

    return c.json({ ok: true });
  });

  return app;
}

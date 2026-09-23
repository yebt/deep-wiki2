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
  listCommentThreads,
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
  PageCommentsResponseSchema,
  SetThreadResolvedRequestSchema,
} from '@deep-wiki/contracts';
import { locateQuoteInBlock, mintAnchorAtBlock, parse, sliceBlocks, stripTrailingAnchor } from '@deep-wiki/markdown';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';
import { savePageRefusal } from './save-page-refusal';

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

/**
 * What a page that has never been saved reads as here: no markdown, so no
 * blocks, so no anchor — and no content hash, which is what `savePage()`
 * reads as "the first save" if the mint ever does have something to write
 * (`apps/api/src/routes/pages.ts`'s `NEVER_SAVED_MARKDOWN`, the same value
 * under the same rule).
 */
const EMPTY_DOCUMENT = { markdown: '', contentHash: null } as const;

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

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM live_nodes WHERE id = ${pageId}`;
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

  // comment-threads: "Threads And Resolution State" / comment-overlay's
  // thread panel. Gated by can('comment') — the same gate the indicators
  // endpoint above uses — so a subject with read but not comment sees the
  // identical `{ threads: [] }` shape a page with zero threads would
  // produce, rather than a read-only view that would disagree with what
  // the indicators endpoint already tells that subject (nothing).
  app.get('/pages/:id/comments', auth, async (c) => {
    const pageId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM live_nodes WHERE id = ${pageId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    const canComment = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'comment' });
    if (!canComment) {
      return c.json(PageCommentsResponseSchema.parse({ threads: [], canComment: false }));
    }

    const threads = await listCommentThreads(deps.sql, { pageId });
    return c.json(
      PageCommentsResponseSchema.parse({
        canComment: true,
        threads: threads.map((thread) => ({
          id: thread.id,
          body: thread.body,
          author: { id: thread.authorId, displayName: thread.authorDisplayName },
          createdAt: thread.createdAt.toISOString(),
          anchor: {
            blockId: thread.blockId,
            offsetStart: thread.offsetStart,
            offsetEnd: thread.offsetEnd,
            quote: thread.quote,
            orphaned: thread.orphaned,
          },
          resolved: thread.resolved,
          resolvedAt: thread.resolvedAt ? thread.resolvedAt.toISOString() : null,
          replies: thread.replies.map((reply) => ({
            id: reply.id,
            body: reply.body,
            author: { id: reply.authorId, displayName: reply.authorDisplayName },
            createdAt: reply.createdAt.toISOString(),
          })),
        })),
      }),
    );
  });

  // comment-overlay: "A Comment On An Unanchored Block Mints And Persists
  // An Anchor". A root comment's blockId may still be a derived id
  // (`d:...#n`) — mintAnchorAtBlock() converts it to a real persisted one
  // through the ordinary save transaction before the comment row exists,
  // so the anchor it names always resolves.
  app.post('/pages/:id/comments', auth, async (c) => {
    const pageId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM live_nodes WHERE id = ${pageId}`;
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
      if (parsed.data.blockId === undefined) {
        return c.json(ErrorResponseSchema.parse({ error: 'blockId is required for a new thread' }), 400);
      }

      // A page with no `page_content` row has no block to anchor to — and
      // is not missing: `GET /pages/:id` renders it as an empty document
      // (2026-09-23). Answering "not found" here would tell a caller the
      // read route has just served that the page is gone, so the empty
      // document takes the same exit a block that no longer resolves does,
      // one branch below: `mintAnchorAtBlock('')` finds nothing and the
      // 409 says so.
      const content = (await readPageMarkdown(deps.sql, { nodeId: pageId, workspaceId: node.workspace_id })) ?? EMPTY_DOCUMENT;

      // The page's full id registry, every status — the mint must avoid a
      // tombstoned or superseded id the current markdown no longer shows,
      // or the save below refuses its own anchor as dead (docs/TODO.md,
      // 2026-09-13 follow-up; `reconcileBlocks` passes the same set).
      const knownRows = await deps.sql<{ block_id: string }[]>`
        SELECT block_id FROM page_blocks WHERE page_id = ${pageId} AND workspace_id = ${node.workspace_id}
      `;
      const reservedIds = new Set(knownRows.map((row) => row.block_id));

      const minted = mintAnchorAtBlock(content.markdown, parsed.data.blockId, reservedIds);
      // The client named a block off the cached HTML it was served. A page
      // saved since then has a new render, and a derived id — a hash of the
      // block's text — stops resolving the moment that text changes, which
      // is what makes a stale one fail closed rather than land on another
      // block. Until now this fell through to `createRootComment` with the
      // unresolved id and surfaced as `comments_block_fk` — a 500 for an
      // ordinary stale-page conflict.
      if (!minted) {
        return c.json(ErrorResponseSchema.parse({ error: 'that block has changed since this page was loaded' }), 409);
      }
      let resolvedBlockId = minted.blockId;

      // The anchor is located in the block's *source* — the reader selected
      // visible text off cached HTML and holds no offsets into the
      // canonical Markdown. `locateQuoteInBlock` guarantees the stored quote
      // is a source substring, which save-time reconciliation's exact rows
      // need; the client's offsets, when sent, only break a tie between
      // repeated occurrences.
      //
      // Located against `minted.markdown` — the bytes this request is about
      // to store — and not the document that was read, because the mint does
      // not only append: it also respells whatever canonical form the append
      // invalidated (an escaped trailing space `&#x20;` becomes a literal
      // space once ` ^id` follows it). Offsets taken from the pre-mint source
      // named bytes that were never stored, so the quote stopped being a
      // substring of its own block and skipped reconciliation's exact rows on
      // every later save (docs/TODO.md, 2026-09-23). The trailing ` ^id` is
      // stripped first, so an anchor is never part of an excerpt.
      const slices = sliceBlocks(parse(minted.markdown), minted.markdown);
      const block = slices.find((slice) => slice.id === minted.blockId)!;
      const anchor = locateQuoteInBlock(stripTrailingAnchor(block.text), parsed.data.quote, parsed.data.offsetStart);

      if (minted.markdown !== content.markdown) {
        const [currentRow] = await deps.sql<{ content_hash: string }[]>`
          SELECT content_hash FROM live_page_content WHERE node_id = ${pageId} AND workspace_id = ${node.workspace_id}
        `;
        try {
          await savePage(deps.sql, {
            nodeId: pageId,
            workspaceId: node.workspace_id,
            markdown: minted.markdown,
            expectedContentHash: currentRow!.content_hash,
            updatedBy: session.userId,
            changesetWindowMinutes: deps.changesetWindowMinutes,
          });
        } catch (error) {
          // A refusal of this save is a refusal of the comment, and it must
          // read as one. Every branch here was an unhandled 500 until
          // 2026-09-23: the same `NotCanonicalError` the editor is shown as a
          // 409 with the normalised document attached reached a person
          // commenting on a selection as "something went wrong". The mapping
          // is `PUT /pages/:id`'s own, shared rather than restated.
          const refusal = savePageRefusal(error);
          if (refusal) return c.json(refusal.body, refusal.status);
          throw error;
        }
        resolvedBlockId = minted.blockId;
      }

      const root = await createRootComment(deps.sql, {
        workspaceId: node.workspace_id,
        pageId,
        authorId: session.userId,
        body: parsed.data.body,
        blockId: resolvedBlockId,
        offsetStart: anchor.offsetStart,
        offsetEnd: anchor.offsetEnd,
        quote: anchor.quote,
        quoteHash: quoteHashOf(anchor.quote),
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

    // Joined to live_nodes on page_id: a thread on a now-trashed page must
    // answer identically to an unknown thread (trash-non-disclosure spec).
    const [thread] = await deps.sql<{ workspace_id: string; page_id: string }[]>`
      SELECT c.workspace_id, c.page_id
        FROM comments c
        JOIN live_nodes n ON n.id = c.page_id
       WHERE c.id = ${threadId} AND c.parent_id IS NULL
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

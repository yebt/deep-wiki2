import { z } from 'zod';

/**
 * Request/response schemas for `apps/api/src/routes/comments.ts`
 * (comment-threads, comment-overlay specs).
 */

export const CommentIndicatorSchema = z.object({
  blockId: z.string(),
  count: z.number().int().nonnegative(),
});
export type CommentIndicator = z.infer<typeof CommentIndicatorSchema>;

/** Deliberately the same shape whether the subject lacks `comment` or the page has zero comments (comment-overlay spec). */
export const CommentIndicatorsResponseSchema = z.object({
  indicators: z.array(CommentIndicatorSchema),
});
export type CommentIndicatorsResponse = z.infer<typeof CommentIndicatorsResponseSchema>;

export const CreateCommentRequestSchema = z.object({
  /** The block id the client believes the comment is anchored to — persisted or still-derived. Required for a new thread; omitted for a reply. */
  blockId: z.string().optional(),
  offsetStart: z.number().int().nonnegative().optional(),
  offsetEnd: z.number().int().nonnegative().optional(),
  quote: z.string().optional(),
  body: z.string().min(1),
  /** A reply joins this thread's root instead of anchoring a new one. */
  parentId: z.string().optional(),
  /** Explicit, resolved user ids — never parsed out of free text (mirrors document-editor's own mention resolution). */
  mentionedUserIds: z.array(z.string()).default([]),
});
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;

export const CreateCommentResponseSchema = z.object({
  id: z.string(),
  blockId: z.string().optional(),
});
export type CreateCommentResponse = z.infer<typeof CreateCommentResponseSchema>;

export const SetThreadResolvedRequestSchema = z.object({
  resolved: z.boolean(),
});
export type SetThreadResolvedRequest = z.infer<typeof SetThreadResolvedRequestSchema>;

/**
 * `GET /pages/:id/comments` response (comment-threads spec: "Threads And
 * Resolution State"; comment-overlay spec's gutter/thread panel). Author is
 * shaped down to id and display name only — never an email address, matching
 * `RevisionSummarySchema`'s own author shape.
 */
export const CommentAuthorSchema = z.object({
  id: z.string().nullable(),
  displayName: z.string().nullable(),
});
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

export const CommentReplySchema = z.object({
  id: z.string(),
  body: z.string(),
  author: CommentAuthorSchema,
  createdAt: z.string(),
});
export type CommentReply = z.infer<typeof CommentReplySchema>;

/**
 * A root comment always carries an anchor — `comments_root_has_anchor`
 * makes the alternative unrepresentable — so these fields are required, not
 * nullable. An orphaned thread still carries the excerpt it was captured
 * with (comment-threads spec: "Orphan Is A First-Class State"); `orphaned`
 * is the flag a thread panel renders that state from.
 */
export const CommentAnchorSchema = z.object({
  blockId: z.string(),
  offsetStart: z.number().int().nonnegative(),
  offsetEnd: z.number().int().nonnegative(),
  quote: z.string(),
  orphaned: z.boolean(),
});
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

export const CommentThreadSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: CommentAuthorSchema,
  createdAt: z.string(),
  anchor: CommentAnchorSchema,
  resolved: z.boolean(),
  resolvedAt: z.string().nullable(),
  /** Ordered by creation time (comment-threads spec: "A reply joins the existing thread"). */
  replies: z.array(CommentReplySchema),
});
export type CommentThread = z.infer<typeof CommentThreadSchema>;

/**
 * Deliberately the same shape for a subject with `read` but not `comment`
 * as for a page with zero threads — `{ threads: [] }` — matching
 * `CommentIndicatorsResponseSchema`'s own non-disclosure guarantee so the
 * two endpoints never disagree about what a comment-less caller sees.
 */
export const PageCommentsResponseSchema = z.object({
  threads: z.array(CommentThreadSchema),
});
export type PageCommentsResponse = z.infer<typeof PageCommentsResponseSchema>;

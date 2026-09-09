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

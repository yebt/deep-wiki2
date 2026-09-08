import { z } from 'zod';

/**
 * `GET /pages/:id/history` response (revision-history spec: "Page History
 * Query Returns Revisions Newest First"). Never carries `content` or
 * `blockIndex` — history is a list, not a bulk content dump; a specific
 * revision's content is only ever read as one side of a diff.
 */
export const RevisionSummarySchema = z.object({
  id: z.string(),
  authorId: z.string().nullable(),
  createdAt: z.string(),
  changesetId: z.string().nullable(),
});
export type RevisionSummaryPayload = z.infer<typeof RevisionSummarySchema>;

export const PageHistoryResponseSchema = z.object({
  revisions: z.array(RevisionSummarySchema),
});
export type PageHistoryResponse = z.infer<typeof PageHistoryResponseSchema>;

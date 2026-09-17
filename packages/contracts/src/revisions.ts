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
  /** `users.display_name` at read time — the field the history screen renders "who changed it" from. `null` when the revision has no author. */
  authorDisplayName: z.string().nullable(),
  createdAt: z.string(),
  changesetId: z.string().nullable(),
  /** The revision's stored-markdown hash: two neighbours with the same hash store the same bytes, which the history screen names rather than offering a comparison that would show nothing. */
  contentHash: z.string(),
});
export type RevisionSummaryPayload = z.infer<typeof RevisionSummarySchema>;

export const PageHistoryResponseSchema = z.object({
  revisions: z.array(RevisionSummarySchema),
});
export type PageHistoryResponse = z.infer<typeof PageHistoryResponseSchema>;

/**
 * `GET /books/:id/history` response (changesets spec: "Book-Level History
 * Is One Query"). One entry per changeset, newest first, each carrying the
 * revisions it groups — the input the book-level diff screen needs.
 * `message` is nullable: no code path writes it yet (design.md "Changeset
 * Carries An Optional Message" adds the column with no UI to set it in this
 * change).
 */
export const ChangesetRevisionSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  createdAt: z.string(),
});
export type ChangesetRevisionPayload = z.infer<typeof ChangesetRevisionSchema>;

export const BookChangesetSchema = z.object({
  id: z.string(),
  authorId: z.string().nullable(),
  authorDisplayName: z.string().nullable(),
  message: z.string().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
  revisions: z.array(ChangesetRevisionSchema),
});
export type BookChangesetPayload = z.infer<typeof BookChangesetSchema>;

export const BookHistoryResponseSchema = z.object({
  /** The book node's own title/workspace — so the screen can name the book and link back to its tree. */
  title: z.string(),
  workspaceId: z.string(),
  changesets: z.array(BookChangesetSchema),
});
export type BookHistoryResponse = z.infer<typeof BookHistoryResponseSchema>;

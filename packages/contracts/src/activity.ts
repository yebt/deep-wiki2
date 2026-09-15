import { z } from 'zod';

/**
 * `GET /workspaces/:id/activity` — what the workspace dashboard opens on:
 * "what changed and who is here" (apps/web/PRODUCT.md). Three lists in one
 * response, because they are read together on one screen and each is
 * already filtered through the caller's own grants server-side:
 *
 * - `recent` — the newest saves across every page the caller may read,
 *   each with the four block-diff class counts (block-diff spec) so the
 *   row can say *what* changed in one line without a second request.
 * - `mine` — the caller's own newest saves: what they touched recently.
 * - `threads` — open comment threads the caller is part of or named in,
 *   on pages they may `comment` on, with whether each is waiting on them.
 *
 * Never carries revision or comment *content*: a dashboard is a list, and a
 * page's text is read at `/pages/:id` where the read gate is the page's own.
 */
const AuthorSchema = z.object({
  id: z.string().nullable(),
  displayName: z.string().nullable(),
});

export const ActivityChangeCountsSchema = z.object({
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  modified: z.number().int().min(0),
  moved: z.number().int().min(0),
});
export type ActivityChangeCounts = z.infer<typeof ActivityChangeCountsSchema>;

export const RecentChangeSchema = z.object({
  revisionId: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  author: AuthorSchema,
  createdAt: z.string(),
  changes: ActivityChangeCountsSchema,
});
export type RecentChange = z.infer<typeof RecentChangeSchema>;

export const OwnEditSchema = z.object({
  revisionId: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  createdAt: z.string(),
});
export type OwnEdit = z.infer<typeof OwnEditSchema>;

export const ThreadForYouSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  /** The excerpt the thread anchors to — the one line that says what it is about. */
  quote: z.string(),
  orphaned: z.boolean(),
  author: AuthorSchema,
  replyCount: z.number().int().min(0),
  lastActivityAt: z.string(),
  /** Some message in the thread writes `@<the caller's display name>`. A plain-text convention, not a structured mention. */
  mentionsYou: z.boolean(),
  /** The newest message in the thread is someone else's. */
  awaitsYou: z.boolean(),
});
export type ThreadForYou = z.infer<typeof ThreadForYouSchema>;

export const WorkspaceActivityResponseSchema = z.object({
  workspace: z.object({ id: z.string(), name: z.string() }),
  recent: z.array(RecentChangeSchema),
  mine: z.array(OwnEditSchema),
  threads: z.array(ThreadForYouSchema),
});
export type WorkspaceActivityResponse = z.infer<typeof WorkspaceActivityResponseSchema>;

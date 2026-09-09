import { z } from 'zod';

/**
 * `GET /workspaces` — the list of workspaces the caller may open, and the
 * only thing that tells a client which `:id` `/workspaces/:id/tree`
 * accepts.
 *
 * Three fields, deliberately: an `id` to build the link from, a `name` to
 * render, and the `slug` the user recognises from a URL. `ownerId`,
 * `settings` and the timestamps are not here — a workspace the caller can
 * read one page of is not thereby entitled to who owns it or how it is
 * configured, and `z.object` strips what it does not declare, so the
 * schema is the boundary rather than a description of one.
 */
export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type WorkspaceSummaryPayload = z.infer<typeof WorkspaceSummarySchema>;

/**
 * An empty array is a real answer, not an error: a caller who can read no
 * workspace gets `{ workspaces: [] }` with a 200, and it is byte-identical
 * to the answer a caller with none at all gets. Those two cases must not be
 * distinguishable on the wire — telling them apart would disclose that a
 * workspace exists which the caller may not see.
 */
export const WorkspaceListResponseSchema = z.object({
  workspaces: z.array(WorkspaceSummarySchema),
});
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;

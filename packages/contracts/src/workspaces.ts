// By its own subpath, not the core barrel — see nodes.ts.
import { MAX_SLUG_LENGTH, slugifyTitle } from '@deep-wiki/core/nodes/slug';
import { z } from 'zod';
import { StartingGrantSchema } from './invitations';

export { slugifyTitle };

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

/**
 * `POST /workspaces` — create a workspace for the caller.
 *
 * The slug is the caller's to choose, unlike a node's (`nodes.ts` derives
 * that one from the title): a workspace slug is the name a team will see
 * in every URL and is worth a deliberate choice. It must already be in the
 * form `slugifyTitle` produces, so the server never silently stores a URL
 * that differs from the one the user typed and saw — the same rule that
 * keeps a node's slug from disagreeing with its title.
 */
export const WORKSPACE_NAME_MAX_LENGTH = 120;

export const WorkspaceSlugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .refine((slug) => slugifyTitle(slug) === slug, { message: 'use lowercase letters, digits and single hyphens' });

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX_LENGTH),
  slug: WorkspaceSlugSchema,
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>;

export const CreateWorkspaceResponseSchema = z.object({
  workspaceId: z.string(),
  rootNodeId: z.string(),
});
export type CreateWorkspaceResponse = z.infer<typeof CreateWorkspaceResponseSchema>;

/**
 * The three ways a well-formed creation is refused, each its own state on
 * the screen (docs/UI-CHECKLIST.md §3): the plan's limit is reached and
 * the number is named; the account has no plan at all and only the
 * instance operator can change that; the slug is already someone's.
 * `error` keeps the generic `ErrorResponse` shape so a client that reads
 * only that field still gets a sentence.
 */
export const CreateWorkspaceRefusalSchema = z.discriminatedUnion('reason', [
  z.object({ error: z.string(), reason: z.literal('plan_limit'), planName: z.string(), maxWorkspaces: z.number().int() }),
  z.object({ error: z.string(), reason: z.literal('no_plan') }),
  z.object({ error: z.string(), reason: z.literal('slug_taken') }),
]);
export type CreateWorkspaceRefusal = z.infer<typeof CreateWorkspaceRefusalSchema>;

/**
 * `GET /workspaces/:id/members` — who belongs to a workspace and who has
 * been invited and not yet accepted. Reachable only with `manage` on the
 * root; absent and denied answer identically (404).
 *
 * `email` is here because it is what tells two members with the same
 * display name apart, and an admin who may invite by email may also see
 * it. Nothing secret-shaped is declared, and `z.object` strips the rest:
 * an invitation row's `token_hash` cannot reach the wire through this
 * schema even if a widened query selected it.
 */
export const WorkspaceMemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
});
export type WorkspaceMemberPayload = z.infer<typeof WorkspaceMemberSchema>;

export const PendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  startingGrants: z.array(StartingGrantSchema),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type PendingInvitationPayload = z.infer<typeof PendingInvitationSchema>;

export const WorkspaceMembersResponseSchema = z.object({
  workspace: WorkspaceSummarySchema,
  /** The node a workspace-wide starting grant is written against. */
  rootNodeId: z.string(),
  members: z.array(WorkspaceMemberSchema),
  invitations: z.array(PendingInvitationSchema),
  /** True when the member list was cut at the server's bound (`WORKSPACE_MEMBERS_LIMIT`). */
  truncated: z.boolean(),
});
export type WorkspaceMembersResponse = z.infer<typeof WorkspaceMembersResponseSchema>;

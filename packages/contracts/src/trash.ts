import { z } from 'zod';
import { NodeTypeSchema } from './nodes';

/**
 * Request/response schemas for the trash surface (node-trash,
 * trash-restore, deletion-trace specs; design.md Decision 7):
 * `DELETE /nodes/:id`, `POST /nodes/:id/force-delete`,
 * `GET /workspaces/:ref/trash`, `GET /trash/nodes/:id`,
 * `POST /trash/:operationId/restore`. No field here is secret-shaped
 * (query-boundaries rule 5).
 */

export const TrashedCountsSchema = z.object({
  pages: z.number().int().nonnegative(),
  containers: z.number().int().nonnegative(),
});
export type TrashedCounts = z.infer<typeof TrashedCountsSchema>;

/** `DELETE /nodes/:id` / `POST /nodes/:id/force-delete` success (design.md Decision 3). */
export const TrashNodeResponseSchema = z.object({
  trashOperationId: z.string(),
  trashed: TrashedCountsSchema,
});
export type TrashNodeResponse = z.infer<typeof TrashNodeResponseSchema>;

/** `409` when a container has live children and the caller is not the owner submitting force-delete. `canForce` tells the client whether to offer the confirmText dialog at all. */
export const NotEmptyRefusalSchema = z.object({
  error: z.literal('not_empty'),
  pages: z.number().int().nonnegative(),
  containers: z.number().int().nonnegative(),
  canForce: z.boolean(),
});
export type NotEmptyRefusal = z.infer<typeof NotEmptyRefusalSchema>;

/** `POST /nodes/:id/force-delete` body — the owner's typed name and the count they were shown. */
export const ForceDeleteRequestSchema = z.object({
  confirmName: z.string().min(1),
  acceptedCount: z.number().int().nonnegative(),
});
export type ForceDeleteRequest = z.infer<typeof ForceDeleteRequestSchema>;

export const NameMismatchRefusalSchema = z.object({ error: z.literal('name_mismatch') });
export type NameMismatchRefusal = z.infer<typeof NameMismatchRefusalSchema>;

/** A page was created between the confirmation and the submit — the fresh count the server just re-counted. */
export const StaleCountRefusalSchema = z.object({
  error: z.literal('stale_count'),
  pages: z.number().int().nonnegative(),
  containers: z.number().int().nonnegative(),
});
export type StaleCountRefusal = z.infer<typeof StaleCountRefusalSchema>;

const DisplayNameSchema = z.object({ id: z.string(), displayName: z.string() });
const RestoreBlockedBySchema = z.object({ title: z.string() });

/** `GET /workspaces/:ref/trash` — one row per manageable trash operation root (trash-restore spec). */
export const TrashListingItemSchema = z.object({
  operationId: z.string(),
  root: z.object({ id: z.string(), type: NodeTypeSchema, title: z.string() }),
  location: z.array(z.string()),
  trashedBy: DisplayNameSchema.nullable(),
  trashedAt: z.string(),
  purgeAt: z.string(),
  daysLeft: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  containers: z.number().int().nonnegative(),
  restoreBlockedBy: RestoreBlockedBySchema.nullable(),
});
export type TrashListingItem = z.infer<typeof TrashListingItemSchema>;

export const TrashListingResponseSchema = z.object({
  items: z.array(TrashListingItemSchema),
});
export type TrashListingResponse = z.infer<typeof TrashListingResponseSchema>;

/** `GET /trash/nodes/:id` and the `trash` block on `GET /pages/:id` (design.md Decision 7). */
export const TrashLookupResponseSchema = z.object({
  operationId: z.string(),
  trashedAt: z.string(),
  trashedBy: DisplayNameSchema.nullable(),
  daysLeft: z.number().int().nonnegative(),
  restoreBlockedBy: RestoreBlockedBySchema.nullable(),
});
export type TrashLookupResponse = z.infer<typeof TrashLookupResponseSchema>;

/** `POST /trash/:operationId/restore` body — "restore as …", never a minted suffix. */
export const RestoreRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
});
export type RestoreRequest = z.infer<typeof RestoreRequestSchema>;

export const RestoreResponseSchema = z.object({
  nodeId: z.string(),
  parentId: z.string(),
  slug: z.string(),
});
export type RestoreResponse = z.infer<typeof RestoreResponseSchema>;

export const RestoreAncestorTrashedRefusalSchema = z.object({
  error: z.literal('ancestor_trashed'),
  ancestor: z.object({ title: z.string() }),
});
export type RestoreAncestorTrashedRefusal = z.infer<typeof RestoreAncestorTrashedRefusalSchema>;

export const RestoreSlugTakenRefusalSchema = z.object({
  error: z.literal('slug_taken'),
  sibling: z.object({ title: z.string() }),
});
export type RestoreSlugTakenRefusal = z.infer<typeof RestoreSlugTakenRefusalSchema>;

/**
 * One `node_deletions` line for the book history timeline (deletion-trace
 * spec). A `restricted` row the subject may not see has `title` and
 * `actorDisplayName` nulled out by the route before this schema ever sees
 * it — "the row exists" survives, "detail" does not.
 */
export const DeletionTraceSchema = z.object({
  id: z.string(),
  event: z.enum(['trashed', 'restored', 'purged']),
  nodeType: NodeTypeSchema,
  title: z.string().nullable(),
  actorDisplayName: z.string().nullable(),
  occurredAt: z.string(),
  restricted: z.boolean(),
});
export type DeletionTracePayload = z.infer<typeof DeletionTraceSchema>;

import { LEGAL_PARENT_TYPES, legalChildTypes, NODE_TYPES, type NodeType } from '@deep-wiki/core';
import { z } from 'zod';

/**
 * Request/response schemas for node creation and rename
 * (`apps/api/src/routes/tree.ts`).
 *
 * ── Why the hierarchy is re-exported from here ─────────────────────────
 *
 * `apps/web` depends on `@deep-wiki/contracts` and not on
 * `@deep-wiki/core`, and the tree screen has to know which types may be
 * created under a given parent in order to offer them. Listing them in
 * the client would be a second copy of `LEGAL_PARENT_TYPES` — the defect
 * docs/TODO.md has recorded five times, and the reason the table moved
 * into `packages/core` in the first place. This module re-exports the one
 * table instead, so the menu the user sees and the rule the server
 * enforces cannot disagree.
 *
 * `NodeTypeSchema` is built from `NODE_TYPES` for the same reason: the
 * enum is not restated here, it is read.
 */
export { LEGAL_PARENT_TYPES, legalChildTypes };
export type { NodeType };

export const NodeTypeSchema = z.enum(NODE_TYPES as [NodeType, ...NodeType[]]);

/**
 * `title` is the only thing the caller names; the slug is derived
 * server-side (`packages/core/src/nodes/slug.ts`), so a client can never
 * choose a URL that disagrees with the name on screen. 200 characters is
 * generous for a tree label and well inside `nodes.title`'s text column.
 */
export const NODE_TITLE_MAX_LENGTH = 200;

const TitleSchema = z.string().trim().min(1).max(NODE_TITLE_MAX_LENGTH);

/**
 * `type` accepts every node type, including `workspace`, deliberately.
 * Legality is not a shape question — it depends on the parent — and
 * answering it here would put a second, partial copy of
 * `LEGAL_PARENT_TYPES` in a zod enum. The route refuses an illegal pair
 * through the one table and reports which pair it was.
 */
export const CreateNodeRequestSchema = z.object({
  parentId: z.string().min(1),
  type: NodeTypeSchema,
  title: TitleSchema,
});
export type CreateNodeRequest = z.infer<typeof CreateNodeRequestSchema>;

export const CreateNodeResponseSchema = z.object({
  id: z.string(),
  parentId: z.string(),
  type: NodeTypeSchema,
  slug: z.string(),
  title: z.string(),
  position: z.number().int().nonnegative(),
});
export type CreateNodeResponse = z.infer<typeof CreateNodeResponseSchema>;

export const RenameNodeRequestSchema = z.object({
  title: TitleSchema,
});
export type RenameNodeRequest = z.infer<typeof RenameNodeRequestSchema>;

export const RenameNodeResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
});
export type RenameNodeResponse = z.infer<typeof RenameNodeResponseSchema>;

/**
 * `GET /nodes/:id/location` — which workspace a node lives in, named by
 * the id the API is keyed by and by the slug the address bar carries
 * (`/w/<slug>/p/<id>`). The one thing a client needs to turn a bare node
 * id — an old `/pages/<id>` bookmark, a link pasted without its workspace
 * — into the page's real address. Nothing about the node's content or
 * title: this is a locator, and a caller who may not read the node gets
 * the same 404 as one asking about a node that does not exist.
 */
export const NodeLocationResponseSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  workspaceId: z.string(),
  workspaceSlug: z.string(),
});
export type NodeLocationResponse = z.infer<typeof NodeLocationResponseSchema>;

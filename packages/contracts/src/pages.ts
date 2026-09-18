import { z } from 'zod';
import { NodeWorkspaceSchema } from './nodes';
import { TrashLookupResponseSchema } from './trash';

/**
 * Request/response schemas for `apps/api/src/routes/pages.ts`
 * (page-content spec; content-and-editor design.md "The save transaction",
 * "Fail-closed: the per-document probe").
 */

export const SavePageRequestSchema = z.object({
  markdown: z.string(),
  /** `null` for the first save; otherwise the `contentHash` last read (D16). */
  expectedContentHash: z.string().nullable(),
});
export type SavePageRequest = z.infer<typeof SavePageRequestSchema>;

export const SavePageResponseSchema = z.object({
  contentHash: z.string(),
  /** `true` when the submitted markdown was byte-identical to what was stored: nothing was written and no revision exists for this save (`savePage()`'s own `unchanged`). */
  unchanged: z.boolean(),
});
export type SavePageResponse = z.infer<typeof SavePageResponseSchema>;

export const ReadPageResponseSchema = z.object({
  html: z.string(),
  title: z.string(),
  /** The read screen opens the workspace-scoped presence stream with this (editing-presence spec). The only other route that carries it, `GET /pages/:id/edit-session`, acquires the edit lock as a side effect and must never be called just to read a field off it. */
  workspaceId: z.string(),
  /** The same workspace, with the slug the address carries — what the frame checks `/w/<slug>/p/<id>` against (`NodeWorkspaceSchema`). */
  workspace: NodeWorkspaceSchema,
  /** Present only when this page is trashed and the caller may `manage` it (design.md Decision 7, `trashLookup`). Its absence for everyone else is byte-identical to a page that was never trashed at all — a former reader without `manage` never reaches this shape (`live_nodes` misses first, `apps/api/src/routes/pages.ts`). */
  trash: TrashLookupResponseSchema.optional(),
});
export type ReadPageResponse = z.infer<typeof ReadPageResponseSchema>;

const OfferedExitSchema = z.enum(['read_only', 'normalise', 'take_over']);

/** The per-document round-trip probe's refusal, verbatim in the 409 body (design.md "Fail-closed: the per-document probe"). */
export const EditSessionRefusalSchema = z.object({
  reason: z.enum(['unsupported_construct', 'not_byte_identical', 'locked']),
  construct: z.string().optional(),
  line: z.number().optional(),
  holder: z.object({ userId: z.string(), acquiredAt: z.string(), heartbeatAt: z.string() }).optional(),
  offeredExits: z.array(OfferedExitSchema),
  /** A refused session is still about a page the caller may write, on an address the frame holds to its word (`NodeWorkspaceSchema`). */
  workspace: NodeWorkspaceSchema,
});
export type EditSessionRefusal = z.infer<typeof EditSessionRefusalSchema>;

export const EditSessionResponseSchema = z.object({
  markdown: z.string(),
  title: z.string(),
  /** Needed client-side for the `@` mention endpoints, which are scoped by workspace. */
  workspaceId: z.string(),
  /** The same workspace, with the slug the address carries (`NodeWorkspaceSchema`). */
  workspace: NodeWorkspaceSchema,
  /**
   * The `content_hash` of the row this response just read (D16 — optimistic
   * concurrency). Without it, the first `PUT /pages/:id` from this session
   * has no `expectedContentHash` to send but `null`, which `savePage()`
   * treats as a brand-new page and refuses with a stale-content 409 on
   * every page that already has content (docs/TODO.md Finding, this task).
   */
  contentHash: z.string(),
  lock: z.object({ holderUserId: z.string(), acquiredAt: z.string(), heartbeatAt: z.string() }),
});
export type EditSessionResponse = z.infer<typeof EditSessionResponseSchema>;

/** `PATCH /pages/:id/lock` (design.md "Heartbeat Keeps The Lock Alive"). */
export const HeartbeatResponseSchema = z.object({
  status: z.enum(['ok', 'lost']),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

/** `POST /pages/:id/lock/take-over` — same shape as a successful edit-session, since take over always succeeds and hands back the doc to open. */
export const TakeOverResponseSchema = EditSessionResponseSchema;
export type TakeOverResponse = EditSessionResponse;

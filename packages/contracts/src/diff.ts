import { z } from 'zod';

/**
 * `GET /pages/:id/diff?from=&to=` response (block-diff spec). Mirrors
 * `packages/core/src/content/diff.ts`'s `BlockChange` discriminated union
 * exactly, plus a `text` field the route attaches from the two revisions'
 * own `sliceBlocks()` output — `diffBlocks()` itself never carries text
 * (design.md Decision 2), and the diff view has nothing to render without
 * it.
 */
const AddedChangeSchema = z.object({
  kind: z.literal('added'),
  id: z.string(),
  slot: z.number(),
  splitFrom: z.string().optional(),
  text: z.string(),
});
const RemovedChangeSchema = z.object({
  kind: z.literal('removed'),
  id: z.string(),
  slot: z.number(),
  mergedInto: z.string().optional(),
  text: z.string(),
});
const ModifiedChangeSchema = z.object({
  kind: z.literal('modified'),
  id: z.string(),
  fromSlot: z.number(),
  toSlot: z.number(),
  moved: z.boolean(),
  text: z.string(),
});
const MovedChangeSchema = z.object({
  kind: z.literal('moved'),
  id: z.string(),
  fromSlot: z.number(),
  toSlot: z.number(),
  text: z.string(),
});
const UnchangedChangeSchema = z.object({
  kind: z.literal('unchanged'),
  id: z.string(),
  slot: z.number(),
  text: z.string(),
});

export const DiffBlockChangeSchema = z.discriminatedUnion('kind', [
  AddedChangeSchema,
  RemovedChangeSchema,
  ModifiedChangeSchema,
  MovedChangeSchema,
  UnchangedChangeSchema,
]);
export type DiffBlockChangePayload = z.infer<typeof DiffBlockChangeSchema>;

/** Just enough of a revision to label it in the diff header — no author, `getRevisionsByIds` does not carry one. */
export const RevisionMetaSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
});
export type RevisionMetaPayload = z.infer<typeof RevisionMetaSchema>;

export const PageDiffResponseSchema = z.object({
  diff: z.object({
    from: RevisionMetaSchema,
    to: RevisionMetaSchema,
    changes: z.array(DiffBlockChangeSchema),
  }),
});
export type PageDiffResponse = z.infer<typeof PageDiffResponseSchema>;

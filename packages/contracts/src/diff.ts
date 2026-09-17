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
/**
 * One run of text inside an edited block (`packages/core/src/content/
 * inline-diff.ts`'s `InlineSegment`): what the block reads like on one
 * side or both. Concatenating every non-`inserted` segment gives the
 * before text, every non-`deleted` one the after text — `text` on the
 * change is the after text and stays, so a reader of the previous shape
 * loses nothing.
 */
export const InlineSegmentSchema = z.object({
  kind: z.enum(['equal', 'inserted', 'deleted']),
  text: z.string(),
});
export type InlineSegmentPayload = z.infer<typeof InlineSegmentSchema>;

const ModifiedChangeSchema = z.object({
  kind: z.literal('modified'),
  id: z.string(),
  fromSlot: z.number(),
  toSlot: z.number(),
  moved: z.boolean(),
  text: z.string(),
  /** The word-level changes between the block's two sides — only an edited block has two sides of one block to show, so no other kind carries this. */
  segments: z.array(InlineSegmentSchema),
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

/**
 * `GET /books/:id/diff?since=` response (block-diff spec: "Book-Level Diff
 * Aggregates Changed Pages Since A Date"). Each changed page carries its own
 * `text`-bearing changes (via `DiffBlockChangeSchema`, the same shape the
 * page-level route uses), both revision ids `listChangedPagesSince` already
 * computes, and the page's own title — before this schema existed the route
 * returned none of the three, forcing the web book-diff screen to re-derive
 * revision ids from a separate `GET /pages/:id/history` call per page and
 * refetch text from `GET /pages/:id/diff`, reintroducing client-side the
 * N+1 `book-diff.ts`'s own comment says it exists to avoid.
 */
export const ChangedPageDiffSchema = z.object({
  pageId: z.string(),
  pageTitle: z.string(),
  /** `null` when the page's very first revision landed after `since` — there is no earlier revision to diff against. */
  baselineRevisionId: z.string().nullable(),
  latestRevisionId: z.string(),
  diff: z.object({ changes: z.array(DiffBlockChangeSchema) }),
});
export type ChangedPageDiffPayload = z.infer<typeof ChangedPageDiffSchema>;

export const BookDiffResponseSchema = z.object({
  title: z.string(),
  workspaceId: z.string(),
  pages: z.array(ChangedPageDiffSchema),
});
export type BookDiffResponse = z.infer<typeof BookDiffResponseSchema>;

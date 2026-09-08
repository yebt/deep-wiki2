import type { BlockId } from './types';

/**
 * One block's classification between two revisions
 * (versioning-and-collaboration design.md Decision 2, "Where the diff
 * lives"; block-diff spec). A discriminated union on `kind` so each
 * variant only carries the fields that apply to it — `moved` has no text
 * to report, `modified` carries `moved` as a flag so the UI can show both
 * at once rather than forcing a choice between the two facts.
 */
export type BlockChange =
  | { readonly kind: 'added'; readonly id: BlockId; readonly slot: number; readonly splitFrom?: BlockId }
  | { readonly kind: 'removed'; readonly id: BlockId; readonly slot: number; readonly mergedInto?: BlockId }
  | {
      readonly kind: 'modified';
      readonly id: BlockId;
      readonly fromSlot: number;
      readonly toSlot: number;
      readonly moved: boolean;
    }
  | { readonly kind: 'moved'; readonly id: BlockId; readonly fromSlot: number; readonly toSlot: number }
  | { readonly kind: 'unchanged'; readonly id: BlockId; readonly slot: number };

/** The full, ordered result of diffing two revisions' block sets. */
export interface BlockDiff {
  readonly changes: readonly BlockChange[];
}

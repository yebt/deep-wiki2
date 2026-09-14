import type { Root, RootContent } from 'mdast';
import { findBlockAnchor } from './extensions/block-anchor';
import { deriveBlockId } from './match-blocks';

/**
 * The document's block nodes: exactly `tree.children`, one level deep.
 *
 * This is the single definition of "what is a block" that `sliceBlocks`
 * (here) and `buildBlockIndex` (`block-index.ts`) both walk, so the two can
 * never again silently disagree about which nodes exist. They used to: this
 * function used `tree.children` and `buildBlockIndex` used `visit()`,
 * recursing into every descendant — so a persisted `^id` anchor on a list
 * item (nested two levels down: root -> list -> listItem) was found by
 * `buildBlockIndex` and landed in `page_content.block_index`, but
 * `sliceBlocks` never saw it and it never got a `page_blocks` row. The same
 * fact, computed in two places, with nothing keeping them in agreement.
 *
 * Top-level is the deliberate choice, not the accidental one: every other
 * consumer of a "block" — `chunk()`, `diffBlocks()`, `matchBlocks()`, and
 * `packages/db`'s block reconciliation — already only ever addresses a
 * top-level node. A list item is not independently chunkable, diffable, or
 * addressable by anything in this pipeline today, so it is not a block of
 * its own either: a `^id` written on one is still parsed and stripped from
 * the visible text by `applyBlockAnchors` (which is not scoped to
 * top-level nodes — it exists to keep round-tripping byte-identical, not to
 * define block granularity), but it deliberately produces neither a block
 * index entry nor a `BlockSlice` of its own; it round-trips back out
 * through the enclosing list's one block like any other text in that block.
 * docs/TODO.md 2026-09-14 records this as the "seen on the way, not fixed"
 * finding this resolves.
 */
export function topLevelBlocks(tree: Root): readonly RootContent[] {
  return tree.children;
}

/**
 * One top-level block, sliced from its exact source text. Shared by
 * `chunk()` (which only needs `id`/`text`) and the save-transaction's
 * block reconciliation in `packages/db` (which additionally needs
 * `anchorId` to tell "this block already carries a persisted id" apart
 * from "this block's id is only derived", per design.md "Block identity").
 */
export interface BlockSlice {
  /** The persisted anchor id if the block carries one, otherwise the derived identity. */
  readonly id: string;
  /** The persisted anchor id, or `null` if the block carries none. */
  readonly anchorId: string | null;
  readonly text: string;
}

/**
 * Assigns each top-level block its id: the persisted anchor if present,
 * otherwise the derived identity (`d:` + hash + occurrence index, stable
 * under edits above it — markdown-pipeline: Block IDs Are Assigned Lazily).
 */
export function sliceBlocks(tree: Root, source: string): BlockSlice[] {
  const occurrenceCounts = new Map<string, number>();

  return topLevelBlocks(tree).map((node: RootContent) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const text = start !== undefined && end !== undefined ? source.slice(start, end) : '';

    const anchor = findBlockAnchor(node);
    if (anchor) {
      return { id: anchor.id, anchorId: anchor.id, text };
    }

    const occurrence = occurrenceCounts.get(text) ?? 0;
    occurrenceCounts.set(text, occurrence + 1);
    return { id: deriveBlockId(text, occurrence), anchorId: null, text };
  });
}

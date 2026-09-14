import { createHash } from 'node:crypto';
import type { Root } from 'mdast';
import { findBlockAnchor } from './extensions/block-anchor';
import { topLevelBlocks } from './blocks';

export interface BlockIndexEntry {
  /** Byte offset of the owning block's start in the source it was parsed from. */
  start: number;
  /** Byte offset of the owning block's end. */
  end: number;
  /** First 12 hex chars of sha256 of the owning block's source slice, for change detection. */
  hash: string;
}

/** `block_id → {start, end, hash}` (design.md "Block identity" — Index). */
export type BlockIndex = Record<string, BlockIndexEntry>;

/**
 * Builds the derived block index from a parsed tree and the exact source it
 * was parsed from: `block_id → {start, end, hash}`, one entry per persisted
 * anchor. Rebuilt every save; never itself an anchor (docs/SPECS.md §3.3).
 * (markdown-pipeline: Block Index And In-Text Anchors Stay In Sync)
 *
 * Walks `topLevelBlocks()` — the same traversal `sliceBlocks()` uses —
 * rather than recursing into every descendant. It used not to: recursing
 * with `visit()` found anchors nested below the top level (a `^id` on a
 * list item, for instance) that `sliceBlocks()` could never see, so such an
 * anchor was indexed here but never got a `page_blocks` row. See
 * `topLevelBlocks()`'s doc comment in `./blocks` for the full account.
 */
export function buildBlockIndex(tree: Root, source: string): BlockIndex {
  const index: BlockIndex = {};

  for (const node of topLevelBlocks(tree)) {
    const anchor = findBlockAnchor(node);
    if (!anchor) continue;

    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;

    index[anchor.id] = {
      start,
      end,
      hash: createHash('sha256').update(source.slice(start, end)).digest('hex').slice(0, 12),
    };
  }

  return index;
}

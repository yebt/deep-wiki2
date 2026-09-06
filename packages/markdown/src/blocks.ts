import type { Root, RootContent } from 'mdast';
import { findBlockAnchor } from './extensions/block-anchor';
import { deriveBlockId } from './match-blocks';

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

  return tree.children.map((node: RootContent) => {
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

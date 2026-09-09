import { createHash } from 'node:crypto';
import type { Root } from 'mdast';
import type { Node } from 'unist';
import { visit } from 'unist-util-visit';
import { findBlockAnchor } from './extensions/block-anchor';

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
 */
export function buildBlockIndex(tree: Root, source: string): BlockIndex {
  const index: BlockIndex = {};

  visit(tree, (node: Node) => {
    const anchor = findBlockAnchor(node);
    if (!anchor) return;

    const start = (node as Node & { position?: { start: { offset: number } } }).position?.start.offset;
    const end = (node as Node & { position?: { end: { offset: number } } }).position?.end.offset;
    if (start === undefined || end === undefined) return;

    index[anchor.id] = {
      start,
      end,
      hash: createHash('sha256').update(source.slice(start, end)).digest('hex').slice(0, 12),
    };
  });

  return index;
}

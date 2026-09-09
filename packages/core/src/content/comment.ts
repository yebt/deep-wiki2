import type { BlockId } from './types';

/**
 * An anchor pinning a comment to a location in a page's canonical
 * Markdown (versioning-and-collaboration design.md Decision 1, "The
 * comment anchor mechanism"). `quote` is the load-bearing field, not the
 * offsets — offsets are a fast path; the quote is what survives a save
 * that shifts, splits, or merges the block it points at. Orphaning is
 * one-way: `status` never transitions from `orphaned` back to `anchored`.
 */
export interface CommentAnchor {
  readonly blockId: BlockId;
  /** Character offsets into the block's canonical source text at creation. */
  readonly offsetStart: number;
  readonly offsetEnd: number;
  /** The exact text the comment was written about. Captured once, never rewritten. */
  readonly quote: string;
  readonly quoteHash: string;
  readonly status: 'anchored' | 'orphaned';
}

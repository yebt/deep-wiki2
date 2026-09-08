import type { BlockId, BlockIndexEntry } from './types';

/**
 * An immutable snapshot of a page's canonical Markdown and its own block
 * index, written inside the same transaction as the ordinary save
 * (versioning-and-collaboration design.md Decision 7, revision-history
 * spec). Primitive-typed per D19 — no mdast type, ever.
 */
export interface Revision {
  readonly id: string;
  readonly workspaceId: string;
  readonly pageId: string;
  readonly authorId: string;
  readonly createdAt: string;
  /** Full canonical Markdown snapshot. */
  readonly content: string;
  readonly contentHash: string;
  /** Built from this exact `content`, never a later or earlier state. */
  readonly blockIndex: Readonly<Record<BlockId, BlockIndexEntry>>;
  /** `null` when the save did not join or open a changeset. */
  readonly changesetId: string | null;
}

/**
 * Mints a fresh persisted anchor onto a block that currently carries only
 * a derived identity (comment-overlay spec: "A Comment On An Unanchored
 * Block Mints And Persists An Anchor"). Reuses the exact serialisation
 * shape `blockAnchorToMarkdown`/`applyBlockAnchors` already round-trip
 * (GATE-2) — this inserts the same literal ` ^id` text directly at the
 * block's own end offset rather than constructing a second path to the
 * same output.
 */
import { mintBlockId } from './match-blocks';
import { parse } from './pipeline';
import { sliceBlocks, type BlockSlice } from './blocks';

export interface MintAnchorResult {
  readonly markdown: string;
  readonly blockId: string;
}

/**
 * Finds the block whose current id (persisted anchor, or derived identity
 * when unanchored) equals `targetBlockId`. If it already carries a
 * persisted anchor, returns the markdown unchanged. Otherwise mints a
 * fresh id, appends ` ^<id>` at the block's own end offset, and returns
 * the mutated markdown. Returns `null` when no block matches.
 */
export function mintAnchorAtBlock(markdown: string, targetBlockId: string): MintAnchorResult | null {
  const tree = parse(markdown);
  const slices: BlockSlice[] = sliceBlocks(tree, markdown);
  const index = slices.findIndex((slice) => slice.id === targetBlockId);
  if (index === -1) return null;

  const slice = slices[index]!;
  if (slice.anchorId) {
    return { markdown, blockId: slice.anchorId };
  }

  const existingIds = new Set(slices.filter((s): s is BlockSlice & { anchorId: string } => s.anchorId !== null).map((s) => s.anchorId));
  const newId = mintBlockId(existingIds);

  const node = tree.children[index]!;
  const end = node.position!.end.offset!;
  const mutated = `${markdown.slice(0, end)} ^${newId}${markdown.slice(end)}`;

  return { markdown: mutated, blockId: newId };
}

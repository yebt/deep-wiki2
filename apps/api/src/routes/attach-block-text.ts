/**
 * Attaches each `BlockChange`'s own rendered text to it, for the diff
 * route response. `diffBlocks()` reports classification only (design.md
 * Decision 2's `BlockChange` union carries no text) — the diff route
 * already holds both revisions' full content and has already sliced them
 * once to compute the diff, so this looks the text up from that same
 * slicing rather than re-parsing a third time.
 *
 * Which side supplies the text follows which side the change kind is
 * "about": a `removed` block only ever existed on the `before` side, and
 * every other kind — including `modified`, whose whole point is showing
 * what the block became — reads from `after`.
 */
import { diffInline, type BlockChange, type InlineSegment } from '@deep-wiki/core';
import type { BlockSlice } from '@deep-wiki/markdown';

export type DiffChangeWithText =
  | (Exclude<BlockChange, { kind: 'modified' }> & { readonly text: string })
  | (Extract<BlockChange, { kind: 'modified' }> & { readonly text: string; readonly segments: readonly InlineSegment[] });

/**
 * A `modified` block alone also carries its word-level `segments`
 * (`diffInline()`, `packages/core`): the one kind with two sides of one
 * block to show. Diffed between its OWN two slots — `fromSlot` on the
 * before side, `toSlot` on the after side — so a block that moved and
 * changed is compared with itself, never with whatever block now stands
 * where it used to.
 */
export function attachBlockText(
  changes: readonly BlockChange[],
  before: readonly BlockSlice[],
  after: readonly BlockSlice[],
): DiffChangeWithText[] {
  return changes.map((change): DiffChangeWithText => {
    switch (change.kind) {
      case 'removed':
        return { ...change, text: before[change.slot]?.text ?? '' };
      case 'added':
      case 'unchanged':
        return { ...change, text: after[change.slot]?.text ?? '' };
      case 'moved':
        return { ...change, text: after[change.toSlot]?.text ?? '' };
      case 'modified': {
        const beforeText = before[change.fromSlot]?.text ?? '';
        const afterText = after[change.toSlot]?.text ?? '';
        return { ...change, text: afterText, segments: diffInline(beforeText, afterText) };
      }
    }
  });
}

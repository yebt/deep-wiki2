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
import type { BlockChange } from '@deep-wiki/core';
import type { BlockSlice } from '@deep-wiki/markdown';

export type DiffChangeWithText = BlockChange & { readonly text: string };

export function attachBlockText(
  changes: readonly BlockChange[],
  before: readonly BlockSlice[],
  after: readonly BlockSlice[],
): DiffChangeWithText[] {
  return changes.map((change) => {
    switch (change.kind) {
      case 'removed':
        return { ...change, text: before[change.slot]?.text ?? '' };
      case 'added':
      case 'unchanged':
        return { ...change, text: after[change.slot]?.text ?? '' };
      case 'modified':
      case 'moved':
        return { ...change, text: after[change.toSlot]?.text ?? '' };
    }
  });
}

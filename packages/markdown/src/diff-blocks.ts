/**
 * A pure, block-level diff between any two revisions' Markdown
 * (versioning-and-collaboration design.md Decision 2, "Where the diff
 * lives"; block-diff spec). The only diff implementation: no fallback to
 * a text/line differ anywhere, because line diffing destroys "moved",
 * which is free from stable block identity.
 *
 * Both sides are re-parsed and re-sliced fresh from their own stored
 * `content` — never from a revision's stored `block_index`, which is an
 * anchor-only subset and would silently under-report an unanchored
 * document (block-diff spec: "The Diff Re-Parses Both Sides Fresh").
 */
import type { BlockChange, BlockDiff } from '@deep-wiki/core';
import { sliceBlocks, type BlockSlice } from './blocks';
import { matchBlocks, type PersistedBlockRecord } from './match-blocks';
import { parse } from './pipeline';

/**
 * Classifies one after-slot whose previous id resolved `active` somewhere,
 * given whether its slot changed and whether its text changed. Extracted
 * because this three-way branch (unchanged / moved / modified) is the
 * only classification decision `diffBlocks` makes that `matchBlocks`
 * itself has no equivalent for — `matchBlocks` only ever decides
 * active/superseded/tombstoned, never "did the text also change".
 */
function classifyMatchedBlock(
  id: string,
  fromSlot: number,
  toSlot: number,
  textChanged: boolean,
): BlockChange {
  const moved = fromSlot !== toSlot;
  if (!textChanged && !moved) return { kind: 'unchanged', id, slot: toSlot };
  if (!textChanged && moved) return { kind: 'moved', id, fromSlot, toSlot };
  return { kind: 'modified', id, fromSlot, toSlot, moved };
}

export function diffBlocks(before: string, after: string): BlockDiff {
  const beforeSlices: BlockSlice[] = sliceBlocks(parse(before), before);
  const afterSlices: BlockSlice[] = sliceBlocks(parse(after), after);

  const previous: PersistedBlockRecord[] = beforeSlices.map((slice) => ({ id: slice.id, text: slice.text }));
  const previousIds = new Set(previous.map((record) => record.id));
  const previousTextById = new Map(previous.map((record) => [record.id, record.text]));
  const beforeSlotById = new Map<string, number>();
  beforeSlices.forEach((slice, index) => beforeSlotById.set(slice.id, index));

  const afterTexts = afterSlices.map((slice) => slice.text);
  const { assignments, mintedIds } = matchBlocks(previous, afterTexts);

  // `matchBlocks`' pass 3 also pushes each minted id into `assignments`
  // (status 'active', an id from `crypto.getRandomValues`) — every id NOT
  // in `previousIds` is one of those, and is resolved through `mintedIds`
  // below instead, whose `splitFrom` is the only stable fact pass 3
  // produces. The minted id itself is discarded entirely; the block at
  // that after-slot is identified by `afterSlices[slot].id`, which
  // `sliceBlocks` derives deterministically (design.md Decision 2,
  // "Gotcha that must be handled, not discovered").
  // 'tombstoned' needs no tracking of its own: a previous id absent from
  // both maps below is `removed` with no `mergedInto`, whether it never
  // matched anything or matched below MATCH_THRESHOLD.
  const activeSlotByPreviousId = new Map<string, number>();
  const mergedIntoByPreviousId = new Map<string, string>();

  for (const assignment of assignments) {
    if (!previousIds.has(assignment.id)) continue;
    if (assignment.status === 'active') {
      activeSlotByPreviousId.set(assignment.id, assignment.slot!);
    } else if (assignment.status === 'superseded') {
      mergedIntoByPreviousId.set(assignment.id, assignment.supersededBy!);
    }
  }

  const previousIdByActiveSlot = new Map<number, string>();
  for (const [id, slot] of activeSlotByPreviousId) previousIdByActiveSlot.set(slot, id);

  const splitFromByMintedSlot = new Map<number, string>();
  for (const minted of mintedIds) splitFromByMintedSlot.set(minted.slot, minted.splitFrom);

  const changes: BlockChange[] = [];

  // Removed / merged: one entry per previous id that did not survive active.
  for (const record of previous) {
    if (activeSlotByPreviousId.has(record.id)) continue;
    const slot = beforeSlotById.get(record.id)!;
    const mergedInto = mergedIntoByPreviousId.get(record.id);
    changes.push(mergedInto !== undefined ? { kind: 'removed', id: record.id, slot, mergedInto } : { kind: 'removed', id: record.id, slot });
  }

  // Added / unchanged / modified / moved: one entry per after-slot.
  afterSlices.forEach((afterSlice, slot) => {
    const matchedPreviousId = previousIdByActiveSlot.get(slot);

    if (matchedPreviousId === undefined) {
      const splitFrom = splitFromByMintedSlot.get(slot);
      changes.push(splitFrom !== undefined ? { kind: 'added', id: afterSlice.id, slot, splitFrom } : { kind: 'added', id: afterSlice.id, slot });
      return;
    }

    const fromSlot = beforeSlotById.get(matchedPreviousId)!;
    const previousText = previousTextById.get(matchedPreviousId)!;
    const textChanged = previousText !== afterSlice.text;

    changes.push(classifyMatchedBlock(afterSlice.id, fromSlot, slot, textChanged));
  });

  return { changes };
}

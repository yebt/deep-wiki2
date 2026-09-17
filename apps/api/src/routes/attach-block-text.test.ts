/**
 * `diffBlocks()` (block-diff spec) reports classification only — no block
 * text, by design.md Decision 2's own `BlockChange` union. The diff route
 * has both revisions' full content in hand already, so this helper
 * attaches each change's own rendered text by looking it up from the two
 * sides' own `sliceBlocks()` output, never by re-deriving it a second way.
 *
 * versioning-and-collaboration tasks.md quality-bar note (task 10.3): two
 * traps named for this diff work — a fixture where nothing moved never
 * exercises the moved branch, and a fixture where everything changed makes
 * every kind indistinguishable from every other. Each classification below
 * gets its own isolated fixture and its own text assertion.
 */
import { describe, expect, test } from 'bun:test';
import type { BlockChange } from '@deep-wiki/core';
import { parse, sliceBlocks } from '@deep-wiki/markdown';
import { attachBlockText } from './attach-block-text';

describe('attachBlockText', () => {
  test('an added block carries the text of its own after-slot', () => {
    const before = 'First paragraph about apples and oranges.\n';
    const after = 'First paragraph about apples and oranges.\n\nA brand new second paragraph about kiwis.\n';
    const beforeSlices = sliceBlocks(parse(before), before);
    const afterSlices = sliceBlocks(parse(after), after);
    const changes: BlockChange[] = [{ kind: 'added', id: afterSlices[1]!.id, slot: 1 }];

    const result = attachBlockText(changes, beforeSlices, afterSlices);

    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('added');
    expect(result[0]!.text).toContain('kiwis');
    expect(result[0]!.text).not.toContain('apples');
  });

  test('a removed block carries the text of its own before-slot, not the after side', () => {
    const before = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas and pears.\n';
    const after = 'First paragraph about apples and oranges.\n';
    const beforeSlices = sliceBlocks(parse(before), before);
    const afterSlices = sliceBlocks(parse(after), after);
    const changes: BlockChange[] = [{ kind: 'removed', id: beforeSlices[1]!.id, slot: 1 }];

    const result = attachBlockText(changes, beforeSlices, afterSlices);

    expect(result[0]!.text).toContain('bananas');
    expect(result[0]!.text).not.toContain('apples');
  });

  test('a modified block carries the NEW text, distinguishable from an added or removed block in the same result', () => {
    const before = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas and pears.\n';
    const after = 'First paragraph about apples, oranges and grapes now too.\n\nSecond paragraph about bananas and pears.\n';
    const beforeSlices = sliceBlocks(parse(before), before);
    const afterSlices = sliceBlocks(parse(after), after);
    const changes: BlockChange[] = [
      { kind: 'modified', id: afterSlices[0]!.id, fromSlot: 0, toSlot: 0, moved: false },
    ];

    const result = attachBlockText(changes, beforeSlices, afterSlices);

    expect(result[0]!.kind).toBe('modified');
    expect(result[0]!.text).toContain('grapes');
  });

  // The word-level half (owner review 2026-09-17): an edited block carries
  // its inline segments, computed by `diffInline()` in `packages/core`
  // from the two sides' own slice text — never here, never in the route.
  test('a modified block carries word-level segments between its before and after text; no other kind does', () => {
    const before = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas.\n';
    const after = 'First paragraph about apples, oranges and grapes.\n\nSecond paragraph about bananas.\n\nThird.\n';
    const beforeSlices = sliceBlocks(parse(before), before);
    const afterSlices = sliceBlocks(parse(after), after);
    const changes: BlockChange[] = [
      { kind: 'modified', id: afterSlices[0]!.id, fromSlot: 0, toSlot: 0, moved: false },
      { kind: 'unchanged', id: afterSlices[1]!.id, slot: 1 },
      { kind: 'added', id: afterSlices[2]!.id, slot: 2 },
    ];

    const result = attachBlockText(changes, beforeSlices, afterSlices);

    const modified = result[0] as { segments: readonly { kind: string; text: string }[] };
    expect(modified.segments.filter((s) => s.kind !== 'inserted').map((s) => s.text).join('')).toBe(beforeSlices[0]!.text);
    expect(modified.segments.filter((s) => s.kind !== 'deleted').map((s) => s.text).join('')).toBe(afterSlices[0]!.text);
    expect(modified.segments.some((s) => s.kind === 'inserted' && s.text.includes('grapes'))).toBe(true);
    expect(result[1]).not.toHaveProperty('segments');
    expect(result[2]).not.toHaveProperty('segments');
  });

  test('a modified block that also moved diffs against its OLD slot, not the block that now stands there', () => {
    const before = 'Alpha paragraph about apples.\n\nBeta paragraph about bananas and more bananas.\n';
    const after = 'Beta paragraph about bananas and fewer bananas.\n\nAlpha paragraph about apples.\n';
    const beforeSlices = sliceBlocks(parse(before), before);
    const afterSlices = sliceBlocks(parse(after), after);
    const changes: BlockChange[] = [{ kind: 'modified', id: afterSlices[0]!.id, fromSlot: 1, toSlot: 0, moved: true }];

    const [modified] = attachBlockText(changes, beforeSlices, afterSlices) as { segments: readonly { kind: string; text: string }[] }[];

    expect(modified!.segments.filter((s) => s.kind !== 'inserted').map((s) => s.text).join('')).toBe(beforeSlices[1]!.text);
    expect(modified!.segments.map((s) => s.kind)).toEqual(['equal', 'deleted', 'inserted', 'equal']);
  });

  // The quality-bar fixture: a block that GENUINELY moved (byte-identical
  // text, different slot), asserted against a document where something
  // else also stayed put — so this is not the trivial no-op case either.
  test('a moved block carries its byte-identical text, isolated from an unrelated unchanged block', () => {
    const before = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas and pears.\n\nThird paragraph, unrelated, about kiwis.\n';
    const after = 'Second paragraph about bananas and pears.\n\nFirst paragraph about apples and oranges.\n\nThird paragraph, unrelated, about kiwis.\n';
    const beforeSlices = sliceBlocks(parse(before), before);
    const afterSlices = sliceBlocks(parse(after), after);
    const changes: BlockChange[] = [
      { kind: 'moved', id: afterSlices[1]!.id, fromSlot: 0, toSlot: 1 },
      { kind: 'moved', id: afterSlices[0]!.id, fromSlot: 1, toSlot: 0 },
      { kind: 'unchanged', id: afterSlices[2]!.id, slot: 2 },
    ];

    const result = attachBlockText(changes, beforeSlices, afterSlices);

    const moved = result.filter((change) => change.kind === 'moved');
    expect(moved).toHaveLength(2);
    expect(moved.find((change) => change.kind === 'moved' && change.toSlot === 1)!.text).toContain('apples');
    expect(moved.find((change) => change.kind === 'moved' && change.toSlot === 0)!.text).toContain('bananas');
    const unchanged = result.find((change) => change.kind === 'unchanged');
    expect(unchanged!.text).toContain('kiwis');
  });
});

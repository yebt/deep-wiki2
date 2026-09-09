import { describe, expect, test } from 'bun:test';
import { canonicalise } from './index';
import { mintAnchorAtBlock } from './mint-anchor';
import { sliceBlocks } from './blocks';
import { parse } from './pipeline';

// comment-overlay spec: "A Comment On An Unanchored Block Mints And
// Persists An Anchor" — reusing the existing lazy-assignment mechanism
// (block-anchor.ts's own round-trip), never a second serialisation path.
describe('mintAnchorAtBlock', () => {
  test('mints a fresh persisted anchor onto the block matching the given derived id', () => {
    const markdown = 'First paragraph text.\n\nSecond paragraph text.\n';
    const [firstBlock] = sliceBlocks(parse(markdown), markdown);
    expect(firstBlock!.anchorId).toBeNull();

    const result = mintAnchorAtBlock(markdown, firstBlock!.id);

    expect(result).not.toBeNull();
    expect(result!.blockId).not.toBe(firstBlock!.id);
    expect(result!.markdown).toContain(`^${result!.blockId}`);

    // Round-trips byte-identically: reparsing and re-serialising the
    // minted markdown reproduces it exactly (GATE-2).
    expect(canonicalise(result!.markdown)).toBe(result!.markdown);

    const reparsed = sliceBlocks(parse(result!.markdown), result!.markdown);
    expect(reparsed[0]!.anchorId).toBe(result!.blockId);
    expect(reparsed[1]!.anchorId).toBeNull();
  });

  test('returns the existing id unchanged when the block already carries a persisted anchor', () => {
    const markdown = 'A paragraph with a persisted anchor. ^existing1\n';
    const [firstBlock] = sliceBlocks(parse(markdown), markdown);

    const result = mintAnchorAtBlock(markdown, firstBlock!.id);

    expect(result).toEqual({ markdown, blockId: 'existing1' });
  });

  test('returns null when no block matches the given id', () => {
    const markdown = 'Just one paragraph.\n';

    const result = mintAnchorAtBlock(markdown, 'd:doesnotexist#0');

    expect(result).toBeNull();
  });

  test('the minted id never collides with an already-persisted id elsewhere on the page', () => {
    const markdown = 'First paragraph. ^existing1\n\nSecond paragraph, unanchored.\n';
    const [, secondBlock] = sliceBlocks(parse(markdown), markdown);

    const result = mintAnchorAtBlock(markdown, secondBlock!.id);

    expect(result).not.toBeNull();
    expect(result!.blockId).not.toBe('existing1');
  });
});

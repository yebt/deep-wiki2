import { afterEach, describe, expect, test } from 'bun:test';
import { canonicalise } from './index';
import { mintAnchorAtBlock, stripBlockAnchors } from './mint-anchor';
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

/**
 * `mintBlockId` fills ten bytes from `crypto.getRandomValues` and maps each
 * through a 32-character alphabet, so filling every byte with `n` yields the
 * id `ALPHABET[n % 32]` repeated ten times. Driving it deterministically is
 * the only way to assert the exclusion set is a *mechanism*: "the id it
 * happened to mint differed from the one we reserved" is a statement about
 * a 32^10 space, not about the code.
 */
const REAL_GET_RANDOM_VALUES = crypto.getRandomValues.bind(crypto);

function stubMintSequence(fillBytes: readonly number[]): void {
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (crypto as any).getRandomValues = (bytes: Uint8Array) => {
    bytes.fill(fillBytes[Math.min(call, fillBytes.length - 1)]!);
    call++;
    return bytes;
  };
}

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (crypto as any).getRandomValues = REAL_GET_RANDOM_VALUES;
});

describe('mintAnchorAtBlock — reserved ids', () => {
  const MARKDOWN = 'First paragraph, unanchored.\n';
  // Byte 0 -> '0', byte 1 -> '1' through the Crockford alphabet.
  const FIRST_CANDIDATE = '0000000000';
  const SECOND_CANDIDATE = '1111111111';

  test('without a reserved set it mints the first candidate the RNG offers', () => {
    stubMintSequence([0, 1]);
    const [block] = sliceBlocks(parse(MARKDOWN), MARKDOWN);

    expect(mintAnchorAtBlock(MARKDOWN, block!.id)!.blockId).toBe(FIRST_CANDIDATE);
  });

  test('an id the document cannot show — a page\'s tombstoned id — is skipped when reserved', () => {
    stubMintSequence([0, 1]);
    const [block] = sliceBlocks(parse(MARKDOWN), MARKDOWN);

    // The anchors in `MARKDOWN` are the live ids only; a retired id exists
    // solely in the registry, so without this set the mint is blind to it.
    const result = mintAnchorAtBlock(MARKDOWN, block!.id, new Set([FIRST_CANDIDATE]));

    expect(result!.blockId).toBe(SECOND_CANDIDATE);
  });
});

/**
 * The whole reason both functions in this module are canonicalising rather
 * than purely splicing (docs/TODO.md, 2026-09-23). A block whose canonical
 * spelling depends on what follows its last byte cannot be edited by byte
 * offset: the splice lands beside the spelling and invalidates it.
 *
 * The real-world input below is the byte content of the page the project
 * owner hit this on. A paragraph ending in a space is canonically spelled
 * with the space escaped — `&#x20;` — because unescaped trailing
 * whitespace does not survive a reparse. Append ` ^id` and the space is no
 * longer trailing, so its canonical spelling is a literal space again;
 * remove the anchor and the space stops being representable at all. Either
 * direction hands `savePage()` bytes it refuses as non-canonical, which is
 * how a person commenting on a selection got a 500.
 */
const TRAILING_SPACE_PARAGRAPH = 'This is a content @Seed Owner&#x20;\n';

describe('the anchor splice preserves the canonical-form invariant', () => {
  test('a mint on a block whose trailing space is escaped returns canonical markdown', () => {
    expect(canonicalise(TRAILING_SPACE_PARAGRAPH)).toBe(TRAILING_SPACE_PARAGRAPH);
    const [block] = sliceBlocks(parse(TRAILING_SPACE_PARAGRAPH), TRAILING_SPACE_PARAGRAPH);

    const result = mintAnchorAtBlock(TRAILING_SPACE_PARAGRAPH, block!.id);

    expect(result).not.toBeNull();
    // The property, stated as itself: `savePage()` asserts exactly this.
    expect(canonicalise(result!.markdown)).toBe(result!.markdown);
    // And the escape is gone, so this is the respelling rather than a
    // document that merely happened to survive: the space is now literal.
    expect(result!.markdown).toBe(`This is a content @Seed Owner  ^${result!.blockId}\n`);
    // The minted id still resolves in the markdown the caller is handed.
    const [reparsed] = sliceBlocks(parse(result!.markdown), result!.markdown);
    expect(reparsed!.anchorId).toBe(result!.blockId);
  });

  test('stripping that anchor again returns canonical markdown the author can re-save', () => {
    const anchored = 'This is a content @Seed Owner  ^DEADAAAAAA\n';
    expect(canonicalise(anchored)).toBe(anchored);

    const stripped = stripBlockAnchors(anchored, new Set(['DEADAAAAAA']));

    expect(canonicalise(stripped)).toBe(stripped);
    // A space that nothing follows is not representable in canonical form,
    // so the correction drops it rather than handing back `Owner \n`, which
    // the save path would refuse all over again.
    expect(stripped).toBe('This is a content @Seed Owner\n');
  });

  test('a mint leaves a block whose canonical spelling the splice does not touch byte-identical apart from the anchor', () => {
    const markdown = 'A plain paragraph.\n\nAnd a second one.\n';
    const [, second] = sliceBlocks(parse(markdown), markdown);

    const result = mintAnchorAtBlock(markdown, second!.id);

    expect(result!.markdown).toBe(`A plain paragraph.\n\nAnd a second one. ^${result!.blockId}\n`);
  });
});

// The inverse of the mint, used by the save transaction's refusal to hand
// back a document the author can re-submit.
describe('stripBlockAnchors', () => {
  test('removes only the named anchors and leaves every other byte alone', () => {
    const markdown = 'Alpha paragraph. ^aaa1111111\n\nBeta paragraph. ^bbb2222222\n\nGamma paragraph.\n';

    const stripped = stripBlockAnchors(markdown, new Set(['bbb2222222']));

    expect(stripped).toBe('Alpha paragraph. ^aaa1111111\n\nBeta paragraph.\n\nGamma paragraph.\n');
  });

  test('removes several anchors at once without disturbing the offsets of the ones before them', () => {
    const markdown = 'Alpha paragraph. ^aaa1111111\n\nBeta paragraph. ^bbb2222222\n\nGamma paragraph. ^ccc3333333\n';

    const stripped = stripBlockAnchors(markdown, new Set(['aaa1111111', 'ccc3333333']));

    expect(stripped).toBe('Alpha paragraph.\n\nBeta paragraph. ^bbb2222222\n\nGamma paragraph.\n');
  });

  test('the result is canonical, so the caller can re-save it as-is', () => {
    // Headings and paragraphs only: `sliceBlocks` walks `tree.children`, so
    // an anchor on a list item is not a block this function — or the save
    // transaction it serves — can see at all (docs/TODO.md's finding on the
    // `buildBlockIndex`/`sliceBlocks` divergence). Stripping exactly the
    // anchors the save path refuses over is the correct scope.
    const markdown = '# A heading ^hhh1111111\n\nA paragraph. ^ppp3333333\n';

    const stripped = stripBlockAnchors(markdown, new Set(['hhh1111111', 'ppp3333333']));

    expect(stripped).not.toContain('^');
    expect(canonicalise(stripped)).toBe(stripped);
  });

  test('an empty id set returns the markdown unchanged', () => {
    const markdown = 'Alpha paragraph. ^aaa1111111\n';

    expect(stripBlockAnchors(markdown, new Set())).toBe(markdown);
  });

  test('an id no block carries leaves the document untouched', () => {
    const markdown = 'Alpha paragraph. ^aaa1111111\n';

    expect(stripBlockAnchors(markdown, new Set(['zzz9999999']))).toBe(markdown);
  });
});

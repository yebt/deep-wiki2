import { describe, expect, test } from 'bun:test';
import { checkFile } from '../diff-input-purity';

// versioning-and-collaboration block-diff spec: "The Diff Re-Parses Both
// Sides Fresh" — no file calling diffBlocks() (or the implementation
// itself) may reference block_index/blockIndex, the anchor-only column
// this diff must never read as input.
describe('checkFile', () => {
  test('the diff implementation referencing block_index fails', () => {
    const errors = checkFile(
      'packages/markdown/src/diff-blocks.ts',
      "export function diffBlocks() { return revision.block_index; }",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('block_index');
  });

  test('a caller of diffBlocks() that also reads blockIndex fails', () => {
    const errors = checkFile(
      'apps/api/src/routes/diff.ts',
      "const result = diffBlocks(a.blockIndex, b.content);",
    );
    expect(errors).toHaveLength(1);
  });

  test('a caller of diffBlocks() that only passes markdown content passes', () => {
    const errors = checkFile(
      'apps/api/src/routes/diff.ts',
      "const result = diffBlocks(revisionA.content, revisionB.content);",
    );
    expect(errors).toEqual([]);
  });

  test('a file that neither calls diffBlocks() nor is its implementation is ignored, even if it mentions block_index', () => {
    const errors = checkFile(
      'packages/db/src/content/save-page.ts',
      "await tx`INSERT INTO page_content (block_index) VALUES (${blockIndex})`;",
    );
    expect(errors).toEqual([]);
  });

  test('the diff implementation explaining the rule in a doc comment does not self-trigger', () => {
    const errors = checkFile(
      'packages/markdown/src/diff-blocks.ts',
      "/** never reads a revision's stored block_index as input */\nexport function diffBlocks() { return 1; }",
    );
    expect(errors).toEqual([]);
  });
});

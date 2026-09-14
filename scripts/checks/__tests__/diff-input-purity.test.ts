import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkDiffInputPurity, checkFile } from '../diff-input-purity';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'diff-input-purity');

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

// Hole B2: the rule was written against one spelling of the call. An
// import alias renames the binding at the import site, so `diffBlocks as
// diff` then `diff(...)` is the same call the spec forbids feeding stored
// anchors to, wearing a different name.
describe('checkFile — aliased imports of diffBlocks', () => {
  test('an aliased call that also reads blockIndex fails', () => {
    const errors = checkFile(
      'apps/api/src/routes/diff.ts',
      "import { diffBlocks as diff } from '@deep-wiki/markdown';\nconst r = diff(a.blockIndex, b.content);",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('diffBlocks');
  });

  test('an aliased call that only passes content passes', () => {
    const errors = checkFile(
      'apps/api/src/routes/diff.ts',
      "import { diffBlocks as diff } from '@deep-wiki/markdown';\nconst r = diff(a.content, b.content);",
    );
    expect(errors).toEqual([]);
  });

  test('a type-only alias import is not a call site', () => {
    const errors = checkFile(
      'apps/api/src/routes/types.ts',
      "import type { diffBlocks as diff } from '@deep-wiki/markdown';\nconst r = revision.block_index;",
    );
    expect(errors).toEqual([]);
  });

  test('an unrelated local function that happens to be named `diff` is not a diffBlocks call', () => {
    const errors = checkFile(
      'apps/api/src/routes/other.ts',
      "const diff = (a: string, b: string) => a === b;\nconst r = diff(row.block_index, row.content);",
    );
    expect(errors).toEqual([]);
  });
});

// Hole B1: the rule was per-file, so splitting the forbidden data flow
// across two files defeated it entirely. `anchors.ts` reads
// `block_index`, `diff.ts` calls `diffBlocks(loadAnchors(a), …)` — neither
// file trips a per-file rule, and together they are exactly the flow the
// block-diff spec forbids.
describe('checkDiffInputPurity — the forbidden flow split across files', () => {
  test('a diffBlocks() caller whose relative import reads block_index fails', () => {
    const result = checkDiffInputPurity(join(FIXTURES_DIR, 'split-across-files'), ['apps', 'packages']);

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('apps/api/src/routes/diff.ts');
    expect(result.errors[0]).toContain('apps/api/src/routes/anchors.ts');
  });

  test('a diffBlocks() caller whose relative imports only read content passes', () => {
    const result = checkDiffInputPurity(join(FIXTURES_DIR, 'clean'), ['apps', 'packages']);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

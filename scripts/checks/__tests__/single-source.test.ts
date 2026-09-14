/**
 * `LEGAL_PARENT_TYPES` is the one structural invariant that was NOT run by
 * `bun run check` or `.githooks/pre-commit`. It lived in
 * `packages/db/src/nodes/single-source.test.ts`, so it ran only when
 * somebody ran `packages/db`'s suite — which needs a Postgres. Every other
 * invariant in this repository is a script in `scripts/checks/`; this one
 * was a test in a package, and it had the two holes that placement causes.
 *
 * ── Hole 1, measured ───────────────────────────────────────────────────
 *
 * The textual half scanned `import.meta.dir` — `packages/db/src/nodes` —
 * with a non-recursive `readdirSync`. Its regex matches a planted second
 * copy fine; it simply never reads the file. Running its exact scan with a
 * copy planted at `apps/api/src/routes/tree.ts`:
 *
 *     planted a second copy at apps/api/src/routes/tree.ts (in memory):
 *       the regex DOES match it: true
 *       but the scan never reads that file. offenders = []
 *
 * `apps/api/src/routes/tree.ts`, `packages/contracts` and `apps/web` are
 * exactly where a "the client needs the table too" copy lands, and all
 * three were invisible.
 *
 * ── Hole 2, measured ───────────────────────────────────────────────────
 *
 * Its semantic half asserts
 * `legalParentTypesUsedBy()[child].includes(parent)` equals
 * `isLegalParentType(child, parent)` — but `legalParentTypesUsedBy()`
 * *returns* `LEGAL_PARENT_TYPES` and `isLegalParentType` *reads*
 * `LEGAL_PARENT_TYPES`, so both sides are the same object read twice. It is
 * `X.includes(p) === X.includes(p)`. Mutating the table so every parent is
 * legal for a page and re-running its 25-iteration loop:
 *
 *     after mutating LEGAL_PARENT_TYPES.page to every type, the
 *     25-iteration loop reports
 *       mismatches = 0 → the assertion still passes. page parents are now
 *       ["workspace","shelf","book","chapter","page"]
 *
 * So the rules below are stated as properties of the table that a copy of
 * the table cannot satisfy vacuously — and deliberately NOT as a second
 * literal of it here, which would be the very defect being checked.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkNoSecondTable, checkTableIsAHierarchy } from '../single-source';

const FIXTURES = join(import.meta.dir, '..', '__fixtures__', 'single-source');

describe('nobody declares a second parent table (recursively, across every workspace member)', () => {
  test('the one declaration in packages/core is the source, not an offender', () => {
    const result = checkNoSecondTable(join(FIXTURES, 'clean'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('a second table in apps/api/src/routes/tree.ts is found — the copy the old scan could not reach', () => {
    const result = checkNoSecondTable(join(FIXTURES, 'second-copy'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('apps/api/src/routes/tree.ts'))).toBe(true);
  });

  test('a re-declared NodeType union three directories deep in apps/web is found too', () => {
    const result = checkNoSecondTable(join(FIXTURES, 'nested-copy'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('apps/web/app/composables/useNodeTypes.ts'))).toBe(true);
  });
});

describe('the table is a hierarchy, and says so about itself rather than about a copy', () => {
  const NODE_TYPES = ['workspace', 'shelf', 'book', 'chapter', 'page'] as const;

  test('the real table passes', () => {
    const result = checkTableIsAHierarchy(
      {
        workspace: [],
        shelf: ['workspace'],
        book: ['shelf'],
        chapter: ['book'],
        page: ['book', 'chapter'],
      },
      NODE_TYPES,
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // The exact mutation that left the 25-iteration loop green.
  test('a table where every parent is legal for a page fails', () => {
    const result = checkTableIsAHierarchy(
      {
        workspace: [],
        shelf: ['workspace'],
        book: ['shelf'],
        chapter: ['book'],
        page: [...NODE_TYPES],
      },
      NODE_TYPES,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('page'))).toBe(true);
  });

  test('a self-parenting type fails: a cycle is not a hierarchy', () => {
    const result = checkTableIsAHierarchy(
      {
        workspace: [],
        shelf: ['workspace'],
        book: ['shelf', 'book'],
        chapter: ['book'],
        page: ['book', 'chapter'],
      },
      NODE_TYPES,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('book'))).toBe(true);
  });

  test('a mutual pair fails: two types cannot each be the other’s parent', () => {
    const result = checkTableIsAHierarchy(
      {
        workspace: [],
        shelf: ['workspace', 'book'],
        book: ['shelf'],
        chapter: ['book'],
        page: ['book', 'chapter'],
      },
      NODE_TYPES,
    );

    expect(result.ok).toBe(false);
  });

  test('giving the workspace a parent fails: the root of the tree has none', () => {
    const result = checkTableIsAHierarchy(
      {
        workspace: ['shelf'],
        shelf: ['workspace'],
        book: ['shelf'],
        chapter: ['book'],
        page: ['book', 'chapter'],
      },
      NODE_TYPES,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('workspace'))).toBe(true);
  });

  test('a type missing from the table entirely fails', () => {
    const result = checkTableIsAHierarchy(
      { workspace: [], shelf: ['workspace'], book: ['shelf'], chapter: ['book'] },
      NODE_TYPES,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('page'))).toBe(true);
  });

  test('a parent that is not a node type at all fails', () => {
    const result = checkTableIsAHierarchy(
      {
        workspace: [],
        shelf: ['workspace'],
        book: ['shelf'],
        chapter: ['book'],
        page: ['book', 'chapter', 'folder'],
      },
      NODE_TYPES,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('folder'))).toBe(true);
  });
});

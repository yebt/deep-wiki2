import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkManifest, checkCorePurity } from '../core-purity';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');

describe('checkCorePurity', () => {
  test('rejects a deliberate framework import and identifies file + import', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'violating-core'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('hono'))).toBe(true);
    expect(result.errors.some((e) => e.includes('src/index.ts'))).toBe(true);
  });

  test('rejects a non-empty dependencies manifest even without a scanned import', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'violating-core'));

    expect(result.errors.some((e) => /dependencies/i.test(e))).toBe(true);
  });

  test('passes a package with only relative imports and an empty manifest', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'clean-core'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// content-and-editor WU-8 task 8.0 — confirms the gap D19 depends on is real,
// not merely theoretical: a type-only import from a non-relative specifier,
// with no manifest entry at all (the specifier resolves via a hoisted
// workspace node_modules), passed both of the checks above before the
// supplementary regex sweep existed.
describe('type-only imports (D19: no mdast type crosses into core)', () => {
  test('rejects `import type … from` a non-relative specifier with no manifest entry', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'type-only-import-core'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('mdast'))).toBe(true);
    expect(result.errors.some((e) => e.includes('src/index.ts'))).toBe(true);
  });

  test('rejects `export type … from` a non-relative specifier the same way', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'type-only-export-core'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('mdast'))).toBe(true);
  });

  test('a relative `import type` is untouched', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'clean-core'));

    expect(result.ok).toBe(true);
  });
});

// scanImports() elides type-only imports (measured), so an `import type` from a
// framework is invisible to the AST scan. If that framework were declared only
// under devDependencies, nothing checked it either. Both holes had to be open at
// once, and both were.
describe('declared dependencies of every kind', () => {
  test('devDependencies count as a dependency for packages/core', () => {
    const result = checkManifest({ devDependencies: { vue: '^3' } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('vue');
  });

  test('peerDependencies count too', () => {
    expect(checkManifest({ peerDependencies: { hono: '^4' } }).ok).toBe(false);
  });

  test('a manifest declaring nothing passes', () => {
    expect(checkManifest({}).ok).toBe(true);
  });
});

// ── The three live evasions an audit proved by construction ─────────────
//
// Each fixture below was run against the check *before* the fix and passed.
// A check test that constructs a violation the check already caught proves
// nothing; these three are the ones it did not catch.

describe('inline `type` specifiers (the gap between scanImports and the backstop regex)', () => {
  // `scanImports()` elides `import { type Root } from 'mdast'` exactly as it
  // elides `import type { Root } from 'mdast'` (measured). The supplementary
  // regex only matched the second form, because it requires the `type`
  // keyword before the clause. Both mechanisms were blind to the first.
  test('rejects `import { type X } from` a non-relative specifier', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'inline-type-import-core'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('mdast'))).toBe(true);
    expect(result.errors.some((e) => e.includes('src/index.ts'))).toBe(true);
  });
});

describe('ambient runtime globals (an import is not the only way in)', () => {
  // "packages/core must import nothing, not even a Node built-in" was
  // enforced only against import specifiers. `process.env` and `Buffer` need
  // no import: they are ambient. A domain layer that reads the environment
  // is bound to a runtime just as surely as one that imports `node:process`.
  test('rejects `process.env` with no import at all', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'node-globals-core'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('process'))).toBe(true);
  });

  test('rejects `Buffer` with no import at all', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'node-globals-core'));

    expect(result.errors.some((e) => e.includes('Buffer'))).toBe(true);
  });

  test('a global named only inside a comment or a string is not a use', () => {
    // Every real occurrence of these identifiers in packages/core today is
    // prose in a doc comment (`Bun.password`, "process topology"). A check
    // that cannot tell prose from code would have to be turned off.
    const result = checkCorePurity(join(FIXTURES_DIR, 'clean-core'));

    expect(result.ok).toBe(true);
  });
});

describe('source extensions beyond .ts/.tsx', () => {
  // `.mts` is executed by Bun, tsc and Node alike. SOURCE_FILE_PATTERN read
  // only `.ts`/`.tsx`, so a `.mts` file importing a framework was never
  // opened — the file did not exist as far as this check was concerned.
  test('rejects a framework import inside a .mts file', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'mts-source-core'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('hono'))).toBe(true);
    expect(result.errors.some((e) => e.includes('src/helper.mts'))).toBe(true);
  });
});

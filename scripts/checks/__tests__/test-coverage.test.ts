/**
 * The contract `scripts/checks/test-coverage.ts` enforces, stated as
 * executable cases.
 *
 * The rule this replaced measured one thing per *workspace member*: does
 * this directory contain a test file with an `expect(` somewhere in it. A
 * single assertion in `apps/web` therefore certified all 53 files in that
 * app, which is how `EditorSurface.vue`, `AppShell.vue`, `AuthShell.vue`,
 * `NavigationTreeNode.vue`, `PageHeading.vue`, `PageNotice.vue` and
 * `app.vue` all shipped untested under a green gate. The first case below
 * is that exact shape, shrunk to a fixture: a member that has a real,
 * asserting test AND an untested file, which the old rule passed and this
 * one must fail by name.
 *
 * The contract, in full:
 *
 *   A file under `apps/*` or `packages/*` with a source extension, which
 *   is not itself a test file, must satisfy one of
 *
 *     E1  a test file with at least one assertion imports it directly;
 *     E2  a test file imports one of its exported bindings *by name*
 *         through a pure re-export barrel or a workspace package entry;
 *     E3  a named sibling test exists — `<stem>.test.ts`,
 *         `<stem>.<qualifier>.test.ts`, or the same under `__tests__/` —
 *         and contains at least one assertion;
 *
 *   or one of
 *
 *     X1  it erases to nothing at runtime (measured with Bun's
 *         transpiler, not inferred from its filename);
 *     X2  it is a pure re-export barrel;
 *     X3  it is *tool* configuration — `<tool>.config.ts`; a bare
 *         `config.ts` is an application module and is not exempt;
 *     X4  it lives in generated/vendored output;
 *     X5  it is on ALLOW_LIST with a reason.
 *
 *   Two rules keep the gate from decaying back into an existence check:
 *   a test file with no assertion is an error in its own right and is
 *   evidence for nothing; and an ALLOW_LIST entry that is stale — missing
 *   file, or a file that has since become covered or exempt — is an error,
 *   so the list can only shrink without a deliberate edit.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  ALLOW_LIST,
  checkAllowList,
  checkTestCoverage,
  erasesToNothing,
  isBarrel,
  isConfigFile,
  scanImportRecords,
  scanReExports,
} from '../test-coverage';

const FIXTURES = join(import.meta.dir, '..', '__fixtures__', 'test-coverage');
const ROOT = join(import.meta.dir, '..', '..', '..');

/** Fixtures carry no allow-list; the real one is exercised separately. */
function check(fixture: string): { ok: boolean; errors: string[] } {
  return checkTestCoverage(join(FIXTURES, fixture), []);
}

describe('the unit of coverage is the file, not the workspace member', () => {
  test('a member with a real asserting test still fails for the file nothing tests', () => {
    const result = check('member-level-hole');

    // The old rule passed this shape: `covered.test.ts` has an `expect(`,
    // so the member was certified and `Orphan.vue` was never looked at.
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing/src/Orphan.vue');
    expect(result.errors.join('\n')).not.toContain('covered.ts');
  });
});

describe('a barrel is transparent, never absorbent', () => {
  test('importing one binding through a barrel covers only the module that defines it', () => {
    const result = check('barrel');

    // `index.test.ts` imports `{ named }` from './index'. That is evidence
    // about `named.ts` and about nothing else — crediting the whole barrel
    // would be the member-level hole wearing a file-level costume.
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing/src/unnamed.ts');
  });

  test('a namespace import through a barrel credits nothing behind it', () => {
    const result = check('namespace-import');

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing/src/named.ts');
  });
});

describe('a named sibling test is evidence even when it never imports its subject', () => {
  test('schema.explain.test.ts covers schema.ts', () => {
    // packages/db/src/schema.ts is real: its suite asserts against a
    // migrated database and never imports the Drizzle table objects.
    // Demanding a direct import there would be a false positive, and a
    // gate people route around is worse than no gate.
    expect(check('sibling-only')).toEqual({ ok: true, errors: [] });
  });
});

describe('the mechanical exemptions', () => {
  test('type-only modules, barrels and tool config need no test', () => {
    expect(check('exempt')).toEqual({ ok: true, errors: [] });
  });

  test('a bare config.ts is an application module and is not exempt', () => {
    const result = check('bare-config');

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing/src/config.ts');
    expect(result.errors.join('\n')).not.toContain('vitest.config.ts');
  });

  test('isConfigFile requires a tool prefix', () => {
    expect(isConfigFile('nuxt.config.ts')).toBe(true);
    expect(isConfigFile('vitest.config.ts')).toBe(true);
    expect(isConfigFile('astro.config.mjs')).toBe(true);
    expect(isConfigFile('config.ts')).toBe(false);
    expect(isConfigFile('configure.ts')).toBe(false);
  });

  test('erasesToNothing is measured, not guessed from the filename', () => {
    expect(erasesToNothing('types.ts', 'export interface A { a: string }')).toBe(true);
    expect(erasesToNothing('types.ts', 'import type { X } from "./x";\nexport type Y = X;')).toBe(true);
    // The moment a type-named module grows runtime code it loses the exemption.
    expect(erasesToNothing('types.ts', 'export interface A { a: string }\nexport const DEFAULT_A = { a: "" };')).toBe(
      false,
    );
    // A `.vue` or `.astro` file always has runtime behaviour.
    expect(erasesToNothing('Thing.vue', '<template><p>x</p></template>')).toBe(false);
  });

  test('isBarrel accepts only files whose every statement is a re-export', () => {
    expect(isBarrel("export { a } from './a';\nexport type { B } from './b';")).toBe(true);
    expect(isBarrel("export * from './a';")).toBe(true);
    expect(isBarrel("/** doc */\nexport { a } from './a';")).toBe(true);
    expect(isBarrel("export { a } from './a';\nexport const b = 1;")).toBe(false);
    expect(isBarrel('export const b = 1;')).toBe(false);
    expect(isBarrel('')).toBe(false);
  });
});

describe('an assertion-free test file is an error, and is evidence for nothing', () => {
  test('the file it pretends to cover is still reported uncovered', () => {
    const result = check('assertion-free');

    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toContain('subject.test.ts');
    expect(joined).toContain('no assertion');
    expect(joined).toContain('packages/thing/src/subject.ts');
  });
});

describe('the allow-list can only shrink on its own', () => {
  const uncovered = (): 'uncovered' => 'uncovered';

  test('an entry naming a file that no longer exists is an error', () => {
    const errors = checkAllowList(ROOT, [{ file: 'packages/gone/src/x.ts', reason: 'why' }], uncovered);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no longer exists');
  });

  test('an entry whose file has since gained coverage is an error', () => {
    const errors = checkAllowList(
      ROOT,
      [{ file: 'scripts/checks/test-coverage.ts', reason: 'why' }],
      (): 'covered' => 'covered',
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('outlived its reason');
  });

  test('an entry with no reason is an error', () => {
    const errors = checkAllowList(ROOT, [{ file: 'scripts/checks/test-coverage.ts', reason: '  ' }], uncovered);

    expect(errors.some((e) => e.includes('no reason'))).toBe(true);
  });

  test('a duplicated entry is an error', () => {
    const entry = { file: 'scripts/checks/test-coverage.ts', reason: 'why' };
    const errors = checkAllowList(ROOT, [entry, entry], uncovered);

    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  test('every shipped ALLOW_LIST entry names an existing, still-uncovered file with a reason', () => {
    // The real list, checked against the real tree: this is the assertion
    // that makes a forgotten exemption fail the build rather than rot.
    const result = checkTestCoverage(ROOT);
    const allowListErrors = result.errors.filter((e) => e.startsWith('ALLOW_LIST:'));

    expect(allowListErrors).toEqual([]);
    expect(ALLOW_LIST.every((e) => e.reason.trim().length > 0)).toBe(true);
  });
});

describe('import scanning', () => {
  test('scanImportRecords records named bindings per specifier', () => {
    const records = scanImportRecords(
      [
        "import { a, b as c } from './x';",
        "import type { D } from './x';",
        "import def from './y';",
        "import * as z from './z';",
      ].join('\n'),
    );
    const bySpecifier = new Map(records.map((r) => [r.specifier, [...r.names].sort()]));

    expect(bySpecifier.get('./x')).toEqual(['D', 'a', 'b']);
    expect(bySpecifier.get('./y')).toEqual([]);
    expect(bySpecifier.get('./z')).toEqual([]);
  });

  test('scanReExports maps an exported name back to the module it comes from', () => {
    const map = scanReExports("export { a, b as bee } from './ab';\nexport * from './rest';");

    expect(map.named.get('a')).toBe('./ab');
    expect(map.named.get('bee')).toBe('./ab');
    expect(map.wildcards).toEqual(['./rest']);
  });
});

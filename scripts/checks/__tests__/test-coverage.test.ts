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
import { join, relative } from 'node:path';
import {
  ALLOW_LIST,
  checkAllowList,
  checkTestCoverage,
  erasesToNothing,
  hasAssertion,
  hasExecutingAssertion,
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

// A type-only import erases at compile time — `Bun.Transpiler().scanImports()`
// does not even report it, which is why `core-purity.ts` had to add a raw
// scan beside it to see one at all. This gate had the mirror-image hole:
// it counted them. A file of untested runtime logic passed as soon as any
// test imported one of its exported *types*.
describe('a type-only import is not evidence — it cannot exercise a line', () => {
  test('every type-only spelling leaves its target uncovered, and value imports still count', () => {
    const result = check('type-only-import');
    const named = result.errors.join('\n');

    expect(result.ok).toBe(false);
    // `import type { Whole } from './whole'` — the whole-clause spelling.
    expect(named).toContain('packages/thing/src/whole.ts');
    // `import { type Inline } from './inline'` — the inline specifier.
    expect(named).toContain('packages/thing/src/inline.ts');
    // `import type Defaulted from './defaulted'` — the default binding.
    expect(named).toContain('packages/thing/src/defaulted.ts');
    // `export type { Reexported } from './reexported'` written in the test.
    expect(named).toContain('packages/thing/src/reexported.ts');
    // `import { type Shape, valued } from './index'` — a type name must not
    // be carried through a barrel, while `valued` beside it still is.
    expect(named).toContain('packages/thing/src/shaped.ts');
    expect(named).not.toContain('valued.ts');
    expect(result.errors).toHaveLength(5);
  });

  test('scanImportRecords drops type-only names and type-only statements alike', () => {
    const records = scanImportRecords(
      [
        "import { a, b as c } from './x';",
        "import type { D } from './x';",
        "import type { E } from './type-only';",
        "import { type F, g } from './mixed';",
        "import { type H } from './all-type';",
        "import type I from './default-type';",
        "export type { J } from './type-reexport';",
        "import def from './y';",
        "import * as z from './z';",
        "import './side-effect';",
      ].join('\n'),
    );
    const bySpecifier = new Map(records.map((r) => [r.specifier, [...r.names].sort()]));

    // `./x` is still reached — by the value import on the line above it.
    expect(bySpecifier.get('./x')).toEqual(['a', 'b']);
    expect(bySpecifier.get('./mixed')).toEqual(['g']);
    expect(bySpecifier.get('./y')).toEqual([]);
    expect(bySpecifier.get('./z')).toEqual([]);
    expect(bySpecifier.get('./side-effect')).toEqual([]);
    // A statement that erases is not a record at all: not even the bare
    // specifier survives, or E1 would credit the file regardless.
    expect(bySpecifier.has('./type-only')).toBe(false);
    expect(bySpecifier.has('./all-type')).toBe(false);
    expect(bySpecifier.has('./default-type')).toBe(false);
    expect(bySpecifier.has('./type-reexport')).toBe(false);
  });

  test('scanReExports does not map a type-only re-export back to its module', () => {
    const map = scanReExports(
      [
        "export { a } from './ab';",
        "export type { t } from './types';",
        "export { type u, v } from './mixed';",
        "export type * from './all-types';",
        "export * from './rest';",
      ].join('\n'),
    );

    expect(map.named.get('a')).toBe('./ab');
    expect(map.named.get('v')).toBe('./mixed');
    expect(map.named.has('t')).toBe(false);
    expect(map.named.has('u')).toBe(false);
    expect(map.wildcards).toEqual(['./rest']);
  });
});

// `stripComments()` already existed in this file and `isBarrel()` already
// called it; `hasAssertion()` ran its regex over the raw bytes instead. So
// a commented-out `expect(` certified a file AND hid the placeholder test
// from the assertion-free rule — the gate broke its own invariant twice in
// one file.
describe('an assertion has to be code', () => {
  test('an expect( in a comment or a string counts for nothing, and a real one still counts', () => {
    const result = check('commented-assertion');
    const joined = result.errors.join('\n');

    expect(result.ok).toBe(false);
    expect(joined).toContain('real.test.ts');
    expect(joined).toContain('strung.test.ts');
    expect(joined).toContain('packages/thing/src/real.ts');
    expect(joined).toContain('packages/thing/src/strung.ts');
    // The file whose test has a commented-out assertion AND a real one is
    // covered, and its test is not flagged.
    expect(joined).not.toContain('genuine');
    expect(result.errors).toHaveLength(4);
  });

  test('hasAssertion reads code, not prose', () => {
    expect(hasAssertion('// expect(x).toBe(1)\ntest("t", () => {});')).toBe(false);
    expect(hasAssertion('/* assert(x) */\ntest("t", () => {});')).toBe(false);
    expect(hasAssertion('const s = "call expect(x) here";')).toBe(false);
    expect(hasAssertion('const s = `call expect(x) here`;')).toBe(false);
    expect(hasAssertion("const s = 'expect(x)'; // expect(y)\nexpect(z).toBe(1);")).toBe(true);
    expect(hasAssertion('expect(x).toBe(1);')).toBe(true);
    expect(hasAssertion('assert(x);')).toBe(true);
    // A URL is not a line comment, and a regex is not a string.
    expect(hasAssertion('const u = "https://x/y"; expect(u).toBe(1);')).toBe(true);
    expect(hasAssertion('const r = /["\']/; expect(r.test("a")).toBe(false);')).toBe(true);
  });
});

// X3 claimed to be mechanical while matching on the basename alone, so any
// `*.config.ts` anywhere under a member was exempt — `src/retry.config.ts`
// full of retry logic included. What actually makes a file tool
// configuration is structural: a tool loads it by path, so no module
// imports it.
describe('tool configuration is what nothing imports, not what is named config', () => {
  test('a *.config.ts a module imports is a module and needs a test', () => {
    const result = check('nested-config');

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing/src/retry.config.ts');
    // The one nothing imports keeps its exemption.
    expect(result.errors.join('\n')).not.toContain('tool.config.ts');
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

// Found by running the corrected gate over the real tree: `bun run
// scripts/checks/test-coverage.ts .` reported nine files that
// `bun run check` (which passes no argument and gets an absolute cwd) does
// not. `resolveSpecifier` resolves to absolute paths while `walk` inherits
// whatever shape the root was given, so under a relative root E1/E2 credit
// nothing and only sibling-tested files survive. A gate that answers
// differently depending on how its own path was spelled is not a gate.
describe('the answer does not depend on how the root was spelled', () => {
  test('a relative root gives exactly the result an absolute one gives', () => {
    const absolute = join(FIXTURES, 'barrel');
    expect(checkTestCoverage(relative(process.cwd(), absolute), [])).toEqual(
      checkTestCoverage(absolute, []),
    );
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

    // `D` arrives through `import type { D }` and is NOT here: the value
    // import on the line above is the only reason `./x` is reached at all.
    expect(bySpecifier.get('./x')).toEqual(['a', 'b']);
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

// ── Hole 1 ────────────────────────────────────────────────────────────
// `hasAssertion` answered "does an `expect(` appear in this file's code",
// and the whole gate was built on that answer. But `bun test` runs zero
// assertions over a `test.skip` body and zero over a function nothing
// calls, so both spellings certified a module while proving nothing about
// it — and both hid the carrying test file from the assertion-free rule.
// The question has to be "does an assertion in this file EXECUTE".
describe('an assertion counts only when a test actually executes it', () => {
  test('a skipped or todo test is evidence for nothing, and is an error in its own right', () => {
    const result = check('skipped-test');
    const joined = result.errors.join('\n');

    expect(result.ok).toBe(false);
    // `test.skip`, `test.todo` and `describe.skip` each carry a real
    // `expect(` that `bun test` never reaches.
    expect(joined).toContain('skipped.test.ts');
    expect(joined).toContain('postponed.test.ts');
    expect(joined).toContain('described.test.ts');
    expect(joined).toContain('packages/thing/src/skipped.ts');
    expect(joined).toContain('packages/thing/src/postponed.ts');
    expect(joined).toContain('packages/thing/src/described.ts');
    // The one live test still covers its own subject, and is not flagged.
    expect(joined).not.toContain('live');
    expect(result.errors).toHaveLength(6);
  });

  test('an assertion no test callback reaches is evidence for nothing', () => {
    const result = check('unreachable-assertion');
    const joined = result.errors.join('\n');

    expect(result.ok).toBe(false);
    expect(joined).toContain('orphan.test.ts');
    expect(joined).toContain('packages/thing/src/orphan.ts');
    // A helper the test DOES call is still executed, and still counts.
    expect(joined).not.toContain('reached');
    expect(result.errors).toHaveLength(2);
  });

  test('hasExecutingAssertion reads reachability, not presence', () => {
    expect(hasExecutingAssertion('test("t", () => { expect(1).toBe(1); });')).toBe(true);
    expect(hasExecutingAssertion('it("t", () => { assert(1); });')).toBe(true);
    expect(hasExecutingAssertion('test.only("t", () => { expect(1).toBe(1); });')).toBe(true);
    expect(hasExecutingAssertion('test.each([1])("t", (n) => { expect(n).toBe(1); });')).toBe(true);

    // Every skipped spelling.
    expect(hasExecutingAssertion('test.skip("t", () => { expect(1).toBe(1); });')).toBe(false);
    expect(hasExecutingAssertion('it.skip("t", () => { expect(1).toBe(1); });')).toBe(false);
    expect(hasExecutingAssertion('test.todo("t", () => { expect(1).toBe(1); });')).toBe(false);
    expect(hasExecutingAssertion('xit("t", () => { expect(1).toBe(1); });')).toBe(false);
    expect(hasExecutingAssertion('xtest("t", () => { expect(1).toBe(1); });')).toBe(false);
    expect(
      hasExecutingAssertion('describe.skip("s", () => { test("t", () => { expect(1).toBe(1); }); });'),
    ).toBe(false);
    expect(
      hasExecutingAssertion('xdescribe("s", () => { test("t", () => { expect(1).toBe(1); }); });'),
    ).toBe(false);
    // A live test inside a live suite beside a skipped one still counts.
    expect(
      hasExecutingAssertion(
        'describe("s", () => { test.skip("a", () => { expect(1).toBe(1); }); test("b", () => { expect(2).toBe(2); }); });',
      ),
    ).toBe(true);

    // Reachability through a named helper.
    expect(
      hasExecutingAssertion('function h() { expect(1).toBe(1); }\ntest("t", () => { h(); });'),
    ).toBe(true);
    expect(
      hasExecutingAssertion('const h = () => { expect(1).toBe(1); };\ntest("t", () => { h(); });'),
    ).toBe(true);
    // Two hops.
    expect(
      hasExecutingAssertion(
        'function a() { expect(1).toBe(1); }\nfunction b() { a(); }\ntest("t", () => { b(); });',
      ),
    ).toBe(true);
    // Nothing calls it.
    expect(
      hasExecutingAssertion('function h() { expect(1).toBe(1); }\ntest("t", () => {});'),
    ).toBe(false);
    // Called only from a skipped test.
    expect(
      hasExecutingAssertion('function h() { expect(1).toBe(1); }\ntest.skip("t", () => { h(); });'),
    ).toBe(false);
    // A `beforeEach` hook runs, but only when some test does.
    expect(
      hasExecutingAssertion('beforeEach(() => { expect(1).toBe(1); });\ntest("t", () => {});'),
    ).toBe(true);
    expect(
      hasExecutingAssertion('beforeEach(() => { expect(1).toBe(1); });\ntest.skip("t", () => {});'),
    ).toBe(false);
    // `.test(` on a regular expression is not a test registration.
    expect(hasExecutingAssertion('const ok = /a/.test("a");\ntest("t", () => { expect(ok).toBe(true); });')).toBe(
      true,
    );
  });
});

// ── Hole 2 ────────────────────────────────────────────────────────────
// `resolveSpecifier` understood exactly two shapes: a relative path and a
// `@deep-wiki/*` workspace entry. Every alias form fell through to `null`,
// so an aliased import was not an import at all — it credited nothing, and,
// worse, it left a `*.config.ts` full of real logic looking like something
// no module imports, which is precisely X3's definition of tool
// configuration. apps/web writes `~/` and `#` today, so this was live.
describe('an alias is a path, not an escape hatch', () => {
  test('a *.config.ts imported through an alias is still a module', () => {
    const result = check('aliased-config');

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing/src/retry.config.ts');
    // The one nothing imports, by any spelling, keeps its exemption.
    expect(result.errors.join('\n')).not.toContain('tool.config.ts');
  });

  test('every alias form is evidence exactly as a relative path is', () => {
    expect(check('alias-evidence')).toEqual({ ok: true, errors: [] });
  });
});

// ── Hole 3 ────────────────────────────────────────────────────────────
// CLAUDE.md and .githooks/pre-commit both promise that `bun run check`
// fails when "a workspace member has no executing test". The per-file
// rewrite dropped the mechanism and kept the sentence: a member could
// declare `"test": "echo no tests"` and ship. A documented guarantee
// nobody enforces is worse than no guarantee, because people plan around
// it.
describe('every workspace member declares a test runner and runs at least one test', () => {
  test('a `test` script that invokes no test runner is an error', () => {
    const result = check('no-test-script');

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing');
    expect(result.errors[0]).toContain('invokes no test runner');
  });

  test('a member whose files are all exempt still needs one executing test', () => {
    const result = check('no-executing-test');

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('packages/thing');
    expect(result.errors[0]).toContain('no test file');
  });

  test('every real workspace member satisfies the rule', () => {
    const memberErrors = checkTestCoverage(ROOT).errors.filter((e) => /^(apps|packages)\/[^/]+: /.test(e));

    expect(memberErrors).toEqual([]);
  });
});

// ── Hole 4 ────────────────────────────────────────────────────────────
// `apps/` and `packages/` were the whole world, so `scripts/` — thirteen
// structural checks that gate every commit — and `e2e/` were outside the
// gate that they themselves are part of enforcing.
describe('authored source outside apps/ and packages/ is inside the gate', () => {
  test('scripts/ and e2e/ are walked like any other source root', () => {
    const result = check('wider-roots');
    const joined = result.errors.join('\n');

    expect(result.ok).toBe(false);
    expect(joined).toContain('scripts/orphan.ts');
    expect(joined).toContain('e2e/probe.spec.ts');
    expect(joined).not.toContain('scripts/covered.ts');
    expect(result.errors).toHaveLength(2);
  });
});

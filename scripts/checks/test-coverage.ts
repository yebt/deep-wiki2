/**
 * Structural check: every source file that has runtime behaviour is named
 * by at least one real, executing automated test.
 *
 * The previous version of this check asked one question per *workspace
 * member*: "does this directory contain a test file with an `expect(` in
 * it?". One assertion anywhere in `apps/web` therefore certified all 53 of
 * its files, which is exactly how `EditorSurface.vue`, `AppShell.vue` and
 * every other component in that app shipped with no test at all while this
 * gate stayed green. A rule with no mechanism is advice; a rule whose unit
 * of measurement is three orders of magnitude coarser than the thing it
 * claims to measure is advice with a green tick next to it.
 *
 * The unit of measurement here is the source file. For each one, the check
 * asks for *evidence* that a test names it, and only exempts a file when a
 * mechanical property of the file itself proves a test could not say
 * anything about it (it erases to nothing at runtime, it only re-exports,
 * it is tool configuration) or when a human wrote it down in ALLOW_LIST
 * with a reason.
 *
 * ── The contract ───────────────────────────────────────────────────────
 *
 * A file under `apps/*` or `packages/*` with a source extension
 * (SOURCE_EXTENSIONS) that is not itself a test file must satisfy ONE of:
 *
 *  E1  a test file directly imports it — some `*.test.ts`/`*.spec.ts`
 *      containing at least one `expect(`/`assert(` has an import
 *      specifier that resolves to this exact file;
 *
 *  E2  a test file imports one of its exported bindings *by name* through
 *      a pure re-export barrel or a workspace package entry point. Named
 *      bindings only: `import * as x from './index'` credits nothing
 *      beyond the barrel itself, because "one test imported the barrel"
 *      is the member-level hole in file-level clothing;
 *
 *  E3  a named test file sits beside it — `<stem>.test.ts`,
 *      `<stem>.<qualifier>.test.ts`, or the same under `__tests__/` — and
 *      that file contains at least one assertion. This is the convention
 *      the repository already follows, and it is what covers a module a
 *      test exercises without importing it: `packages/db/src/schema.ts`
 *      is tested by `schema.test.ts` through SQL against a migrated
 *      database, never by importing the Drizzle table objects.
 *
 * or ONE of the exemptions:
 *
 *  X1  it erases to nothing at runtime. `Bun.Transpiler().transformSync()`
 *      emits an empty string for a module that is only `interface`/`type`/
 *      `import type` declarations. This is a measurement, not a filename
 *      convention: `types.ts` earns the exemption by containing no runtime
 *      code, and loses it the moment someone adds a `const` to it;
 *
 *  X2  it is a pure re-export barrel — every statement is
 *      `export … from '…'`. A barrel has no behaviour of its own, and E2
 *      makes it transparent rather than absorbent;
 *
 *  X3  it is tool configuration (`*.config.ts` and friends);
 *
 *  X4  it is generated or vendored output (SKIP_DIRS);
 *
 *  X5  it is on ALLOW_LIST below, with a reason.
 *
 * Two further rules keep this from decaying into the check it replaced:
 *
 *  - A test file with zero assertions is an error in its own right, and
 *    is never counted as evidence for anything.
 *  - An ALLOW_LIST entry that names a file which no longer exists, or one
 *    that is now covered or exempt for another reason, is an error. The
 *    list can only shrink without somebody deciding to grow it.
 *
 * ── What this cannot see ───────────────────────────────────────────────
 *
 * This is a static check and it says so plainly: it proves a test *names*
 * a file, not that it *exercises* a line of it. `import './thing'` beside
 * one unrelated assertion still passes. The only thing that closes that
 * last gap is real instrumentation — `bun test --coverage` with a
 * per-file floor — and that cannot live here: this check runs in
 * `.githooks/pre-commit`, must stay under a second, and must not need the
 * Postgres that half the suite provisions. The honest claim is the one in
 * the errors above: nothing names this file. That claim was worth 40+
 * findings the member-level rule could not make.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { findMemberDirs } from './workspace-shape';

export interface TestCoverageResult {
  ok: boolean;
  errors: string[];
}

/** A deliberate, reviewed exemption. Every entry must name a real, uncovered file. */
export interface Exemption {
  /** Repository-relative path, forward slashes. */
  readonly file: string;
  /** Why no test names this file. Reviewed like any other code. */
  readonly reason: string;
}

/**
 * X5. Coverage debt and genuine un-testables, written down one file at a
 * time so that an exemption is a decision somebody made rather than a
 * side effect of where a directory boundary happened to fall.
 *
 * Adding a line here is cheap and visible in review. Leaving one here
 * after the file gains a test is an error (see `checkAllowList`), so the
 * list cannot quietly outlive the reason it was written.
 */
export const ALLOW_LIST: readonly Exemption[] = [
  {
    file: 'apps/landing/src/pages/index.astro',
    reason:
      'apps/landing has no Astro component test harness (its two testable modules, src/lib/*.ts, are ' +
      'sibling-tested). Delete this line the day one is added.',
  },
  {
    file: 'packages/db/migrate.ts',
    reason: 'Operational entry point (bun run db:migrate). Coverage debt — no test drives it end to end.',
  },
  {
    file: 'packages/db/seed.ts',
    reason: 'Operational entry point (bun run db:seed). Coverage debt — exercised only by hand and by e2e/seed.bun.ts.',
  },
  {
    file: 'packages/db/verify-paths.ts',
    reason:
      'Operational entry point wrapping src/nodes/verify-paths.ts, which is itself sibling-tested. ' +
      'Coverage debt: only the argv/exit-code shell is untested.',
  },
  {
    file: 'packages/db/src/permissions/candidates.ts',
    reason: 'Coverage debt: @-mention candidate gathering is exercised only through apps/api/src/routes/mentions.test.ts, which does not name it.',
  },
  {
    file: 'packages/db/src/permissions/grants.ts',
    reason: 'Coverage debt: the permissions write path has no test of its own.',
  },
  {
    file: 'packages/db/src/content/rebuild-derived.ts',
    reason: 'Coverage debt: derived-row reconciliation is exercised only indirectly through save-page.test.ts.',
  },
  {
    file: 'packages/contracts/src/pages.ts',
    reason: 'Coverage debt: the page request/response schemas have no test of their own.',
  },
  {
    file: 'packages/markdown/src/extensions/hard-break.ts',
    reason: 'Coverage debt: hard-break spelling preservation is asserted at pipeline level (corpus.test.ts), not against this module.',
  },
  {
    file: 'packages/markdown/src/extensions/verbatim.ts',
    reason: 'Coverage debt: the verbatim carriers are exercised through packages/editor round-tripping, which does not name this module.',
  },
  {
    file: 'packages/editor/src/mount/create-editor-view.ts',
    reason:
      'Needs a real DOM. packages/editor runs under `bun test` with no DOM; the EditorView is exercised ' +
      'by e2e/editor.spec.ts in a browser instead. Coverage debt until packages/editor gains a DOM harness.',
  },
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs', '.astro']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/;
const ASSERTION_PATTERN = /\b(expect|assert)\s*\(/;
/** X4: generated, vendored or build output — nothing here is authored source. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.output',
  '.nuxt',
  '.astro',
  'coverage',
  '.git',
  '__fixtures__',
]);
/**
 * X3: *tool* configuration — `nuxt.config.ts`, `vitest.config.ts`,
 * `drizzle.config.ts`. The prefix is mandatory: a bare `config.ts` is an
 * application module (`apps/api/src/config.ts` parses and validates the
 * process environment) and must be tested like any other.
 */
const CONFIG_FILE_PATTERN = /^[\w.-]+\.config\.(ts|mts|cts|js|mjs|cjs)$/;
/** Extensions a Bun transpiler can classify. `.vue`/`.astro` always have runtime behaviour. */
const TRANSPILABLE = new Set(['.ts', '.tsx', '.js', '.mjs']);

const WORKSPACE_SCOPE = '@deep-wiki/';
const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '.vue', '.js', '.mjs', '/index.ts', '/index.vue', '/index.js'];

// ── Pure classifiers ───────────────────────────────────────────────────

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(basename(path));
}

export function hasAssertion(code: string): boolean {
  return ASSERTION_PATTERN.test(code);
}

export function isConfigFile(path: string): boolean {
  return CONFIG_FILE_PATTERN.test(basename(path));
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const RE_EXPORT_STATEMENT = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["'][^"']+["']\s*;?/g;

/**
 * X2. True when every statement in the file is `export … from '…'`. Such a
 * module contributes no behaviour of its own; E2 walks *through* it to the
 * modules that do.
 */
export function isBarrel(code: string): boolean {
  const stripped = stripComments(code);
  if (!/\bexport\b/.test(stripped)) return false;
  return stripped.replace(RE_EXPORT_STATEMENT, '').trim().length === 0;
}

/**
 * X1. True when the file compiles to nothing — only `interface`/`type`
 * declarations and type-only imports. Measured, not guessed from the name.
 */
export function erasesToNothing(path: string, code: string): boolean {
  const ext = extname(path);
  if (!TRANSPILABLE.has(ext)) return false;
  try {
    const loader = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'ts' : 'js';
    return new Bun.Transpiler({ loader }).transformSync(code).trim().length === 0;
  } catch {
    return false;
  }
}

export interface ImportRecord {
  /** The module specifier as written. */
  readonly specifier: string;
  /** Bindings imported by name (`import { a, b as c }` -> ['a','b']). Empty for `*`/default-only. */
  readonly names: readonly string[];
}

const NAMED_IMPORT = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const BARE_FROM = /\bfrom\s*["']([^"']+)["']/g;

/** Every `from '…'` in the file, with the names taken through it where they exist. */
export function scanImportRecords(code: string): ImportRecord[] {
  const bySpecifier = new Map<string, Set<string>>();

  for (const [, clause, specifier] of code.matchAll(NAMED_IMPORT)) {
    const set = bySpecifier.get(specifier!) ?? new Set<string>();
    for (const raw of clause!.split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name) set.add(name);
    }
    bySpecifier.set(specifier!, set);
  }

  for (const [, specifier] of code.matchAll(BARE_FROM)) {
    if (!bySpecifier.has(specifier!)) bySpecifier.set(specifier!, new Set());
  }

  return [...bySpecifier].map(([specifier, names]) => ({ specifier, names: [...names] }));
}

export interface ReExportMap {
  /** Exported name -> the specifier it comes from. */
  readonly named: ReadonlyMap<string, string>;
  /** `export * from '…'` specifiers: any name may come from any of these. */
  readonly wildcards: readonly string[];
}

const RE_EXPORT_WITH_TARGET =
  /export\s+(?:type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

export function scanReExports(code: string): ReExportMap {
  const named = new Map<string, string>();
  const wildcards: string[] = [];

  for (const [, clause, specifier] of stripComments(code).matchAll(RE_EXPORT_WITH_TARGET)) {
    if (clause!.startsWith('*')) {
      wildcards.push(specifier!);
      continue;
    }
    for (const raw of clause!.slice(1, -1).split(',')) {
      const parts = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      const local = parts[0]?.trim();
      const exported = (parts[1] ?? parts[0])?.trim();
      if (local && exported) named.set(exported, specifier!);
    }
  }

  return { named, wildcards };
}

// ── Filesystem walk + resolution ───────────────────────────────────────

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) acc.push(full);
  }
  return acc;
}

function resolveFile(base: string): string | null {
  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Map of `@deep-wiki/<pkg>[/<subpath>]` -> absolute entry file, from each manifest's `exports`. */
function workspaceEntryPoints(memberDirs: readonly string[]): Map<string, string> {
  const entries = new Map<string, string>();
  for (const memberDir of memberDirs) {
    let pkg: { name?: string; exports?: Record<string, string> | string };
    try {
      pkg = JSON.parse(readFileSync(join(memberDir, 'package.json'), 'utf8')) as typeof pkg;
    } catch {
      continue;
    }
    if (!pkg.name || !pkg.exports) continue;
    const map = typeof pkg.exports === 'string' ? { '.': pkg.exports } : pkg.exports;
    for (const [subpath, target] of Object.entries(map)) {
      if (typeof target !== 'string') continue;
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
      entries.set(specifier, resolve(memberDir, target));
    }
  }
  return entries;
}

// ── The check ──────────────────────────────────────────────────────────

interface FileFacts {
  readonly barrel: boolean;
  readonly reExports: ReExportMap;
}

const MAX_BARREL_DEPTH = 8;

export function checkTestCoverage(
  root: string,
  allowList: readonly Exemption[] = ALLOW_LIST,
): TestCoverageResult {
  const errors: string[] = [];
  const memberDirs = findMemberDirs(root);
  const allFiles = memberDirs.flatMap((dir) => walk(dir));
  const testFiles = allFiles.filter(isTestFile);
  const sourceFiles = allFiles.filter((f) => !isTestFile(f));
  const entryPoints = workspaceEntryPoints(memberDirs);

  const facts = new Map<string, FileFacts>();
  const factsFor = (file: string): FileFacts => {
    let cached = facts.get(file);
    if (!cached) {
      const code = readFileSync(file, 'utf8');
      cached = { barrel: isBarrel(code), reExports: scanReExports(code) };
      facts.set(file, cached);
    }
    return cached;
  };

  const rel = (file: string): string => relative(root, file).split('\\').join('/');

  /** Resolve a specifier written inside `fromFile` to a file in this repository. */
  const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
    if (specifier.startsWith('.')) return resolveFile(resolve(dirname(fromFile), specifier));
    if (specifier.startsWith(WORKSPACE_SCOPE)) return entryPoints.get(specifier) ?? null;
    return null;
  };

  const covered = new Set<string>();

  /** E1/E2: credit `file`, walking through it when it is a pure barrel. */
  const credit = (file: string, names: readonly string[], depth: number): void => {
    covered.add(file);
    if (depth >= MAX_BARREL_DEPTH) return;
    const { barrel, reExports } = factsFor(file);
    if (!barrel) return;
    // A barrel is transparent, never absorbent: only the names the importer
    // actually wrote propagate. `import * as x from './index'` credits the
    // barrel and stops there.
    for (const name of names) {
      const targets = new Set<string>();
      const direct = reExports.named.get(name);
      if (direct) targets.add(direct);
      for (const wildcard of reExports.wildcards) targets.add(wildcard);
      for (const specifier of targets) {
        const next = resolveSpecifier(file, specifier);
        if (next) credit(next, names, depth + 1);
      }
    }
  };

  for (const testFile of testFiles) {
    const code = readFileSync(testFile, 'utf8');
    if (!hasAssertion(code)) {
      errors.push(
        `${rel(testFile)}: test file contains no assertion (no expect()/assert() call) — an ` +
          `assertion-free test is not coverage, and this file counts as evidence for nothing`,
      );
      continue;
    }
    for (const record of scanImportRecords(code)) {
      const target = resolveSpecifier(testFile, record.specifier);
      if (target) credit(target, record.names, 0);
    }
  }

  // E3: a named test file beside the source (or in its `__tests__/`).
  const assertingTestsByDir = new Map<string, string[]>();
  for (const testFile of testFiles) {
    if (!hasAssertion(readFileSync(testFile, 'utf8'))) continue;
    const dir = dirname(testFile);
    const list = assertingTestsByDir.get(dir) ?? [];
    list.push(testFile);
    assertingTestsByDir.set(dir, list);
  }
  const stemOf = (file: string): string =>
    basename(file)
      .replace(TEST_FILE_PATTERN, '')
      .replace(/\.(ts|tsx|vue|js|mjs|astro)$/, '');
  const hasNamedSiblingTest = (file: string): boolean => {
    const dir = dirname(file);
    const stem = stemOf(file);
    const pool = [...(assertingTestsByDir.get(dir) ?? []), ...(assertingTestsByDir.get(join(dir, '__tests__')) ?? [])];
    return pool.some((t) => {
      const testStem = stemOf(t);
      return testStem === stem || testStem.startsWith(`${stem}.`);
    });
  };

  const allowed = new Map(allowList.map((e) => [e.file, e]));

  /** X1-X4 and the three evidence rules, for one file. */
  const status = (file: string): 'covered' | 'exempt' | 'uncovered' => {
    if (isConfigFile(file)) return 'exempt';
    const code = readFileSync(file, 'utf8');
    if (erasesToNothing(file, code)) return 'exempt';
    if (isBarrel(code)) return 'exempt';
    if (covered.has(file) || hasNamedSiblingTest(file)) return 'covered';
    return 'uncovered';
  };

  const uncovered: string[] = [];
  for (const file of sourceFiles) {
    const relPath = rel(file);
    const state = status(file);
    if (state === 'uncovered' && !allowed.has(relPath)) uncovered.push(relPath);
  }

  for (const relPath of uncovered.sort()) {
    errors.push(
      `${relPath}: no test names this file. Give it a sibling <name>.test.ts, import it from a test, ` +
        `or add it to ALLOW_LIST in scripts/checks/test-coverage.ts with a reason.`,
    );
  }

  errors.push(...checkAllowList(root, allowList, (file) => status(join(root, file))));

  return { ok: errors.length === 0, errors };
}

/**
 * The list can only shrink on its own. An entry whose file has been
 * deleted, or which has since gained coverage or become exempt for a
 * mechanical reason, is an error: it is a claim that is no longer true.
 */
export function checkAllowList(
  root: string,
  allowList: readonly Exemption[],
  statusOf: (file: string) => 'covered' | 'exempt' | 'uncovered',
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of allowList) {
    if (seen.has(entry.file)) {
      errors.push(`ALLOW_LIST: duplicate entry for ${entry.file}`);
      continue;
    }
    seen.add(entry.file);

    if (!entry.reason.trim()) {
      errors.push(`ALLOW_LIST: ${entry.file} has no reason — an exemption without a reason is an accident`);
    }

    if (!existsSync(join(root, entry.file))) {
      errors.push(`ALLOW_LIST: ${entry.file} no longer exists — delete this entry`);
      continue;
    }

    const state = statusOf(entry.file);
    if (state !== 'uncovered') {
      errors.push(
        `ALLOW_LIST: ${entry.file} is now ${state} — delete this entry, the exemption has outlived its reason`,
      );
    }
  }

  return errors;
}

if (import.meta.main) {
  const result = checkTestCoverage(process.argv[2] ?? process.cwd());
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`test-coverage: ${err}`);
    }
    console.error(`test-coverage: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.log('test-coverage: ok');
}

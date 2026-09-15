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
 *      containing at least one `expect(`/`assert(` **in code** has a
 *      *value* import specifier that resolves to this exact file. An
 *      assertion inside a comment or a string literal is not an assertion,
 *      and a type-only import is not an import: `import type { X } from
 *      './x'` erases at compile time and cannot exercise a line of `./x`;
 *
 *  E2  a test file imports one of its exported bindings *by name* through
 *      a pure re-export barrel or a workspace package entry point. Named
 *      bindings only: `import * as x from './index'` credits nothing
 *      beyond the barrel itself, because "one test imported the barrel"
 *      is the member-level hole in file-level clothing. Value names only,
 *      for E1's reason — a type name is not carried through a barrel;
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
 *  X3  it is tool configuration: it is named `<tool>.config.<ext>` AND no
 *      module in the repository imports it. The second half is what makes
 *      this mechanical rather than a naming convention — a tool loads its
 *      config by path, so `packages/core/src/retry.config.ts` full of
 *      retry logic that another module imports is a module, and is not
 *      exempt;
 *
 *  X4  it is generated or vendored output (SKIP_DIRS);
 *
 *  X5  it is on ALLOW_LIST below, with a reason.
 *
 * Two further rules keep this from decaying into the check it replaced:
 *
 *  - A test file with zero assertions is an error in its own right, and
 *    is never counted as evidence for anything. Zero assertions is
 *    measured over the file's *code*: `// TODO: expect(bar(1)).toBe(2)`
 *    is prose, and it used to both certify `bar`'s module and hide the
 *    placeholder test carrying it from this very rule.
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
    file: 'packages/contracts/src/comments.ts',
    reason:
      'Coverage debt, same shape as pages.ts above: the comment request/response schemas are exercised ' +
      'through apps/api/src/routes/comments.ts (a non-test import, so E1/E2 do not credit it) rather than ' +
      'named directly by a test.',
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
  {
    file: 'packages/db/backfill-render.ts',
    reason:
      'Operational entry point (bun run backfill:render), mirroring migrate.ts/seed.ts above. Its own ' +
      'src/content/backfill-render.ts is directly tested; only the argv/exit-code shell is untested.',
  },
  {
    file: 'e2e/seed.bun.ts',
    reason:
      'The e2e seed, spawned as a `bun` child process by e2e/global-setup.ts (never imported), so no test ' +
      'can name it. It is exercised on every `bun run e2e` — every spec depends on the rows it writes — ' +
      'and its guts are packages/db, which is tested directly. Coverage debt only for the argv shell.',
  },
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs', '.astro']);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/;
const ASSERTION_PATTERN = /\b(expect|assert)\s*\(/;
const ASSERTION_PATTERN_GLOBAL = /\b(expect|assert)\s*\(/g;
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
/**
 * A `test` script that actually starts a runner. `"echo no tests"` and
 * `"exit 0"` are the two spellings that make a member green for saying
 * nothing, and both used to pass.
 */
const TEST_RUNNER_PATTERN = /\bbun\s+test\b|\bvitest\b/;
/** Extensions a Bun transpiler can classify. `.vue`/`.astro` always have runtime behaviour. */
const TRANSPILABLE = new Set(['.ts', '.tsx', '.js', '.mjs']);

const WORKSPACE_SCOPE = '@deep-wiki/';
const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '.vue', '.js', '.mjs', '/index.ts', '/index.vue', '/index.js'];

/**
 * Source roots outside the workspace members. `apps/*` and `packages/*`
 * were the whole world here, which put `scripts/` — the thirteen
 * structural checks that gate every commit, this one included — and `e2e/`
 * outside the gate they exist to enforce. They are authored TypeScript
 * with the same claim on a test as anything under `packages/`; the only
 * thing that made them invisible was that they carry no `package.json`.
 */
const EXTRA_SOURCE_ROOTS = ['scripts', 'e2e'];

/**
 * Path aliases, and the bases each one may resolve against, in order.
 *
 * A specifier is a path however it is spelled. `resolveSpecifier`
 * understood exactly two spellings — relative, and a `@deep-wiki/*`
 * workspace entry — so every alias form fell through to "not a module in
 * this repository". That cost twice over: an aliased import from a test
 * credited nothing (E1/E2 could not see it), and an aliased import from
 * source left its target looking like a file no module imports, which is
 * X3's *entire* definition of tool configuration. `~/utils/retry.config`
 * was therefore exempt while `./utils/retry.config` was correctly
 * reported. apps/web writes `~/` today, so this was live, not theoretical.
 *
 * `~~/` and `@@/` name the package root; `~/` and `@/` name its source
 * directory, which is `app/` under Nuxt 4, `src/` elsewhere, and the
 * package root itself in a flat package. First base that resolves to a
 * real file wins, and a specifier that resolves to nothing stays nothing.
 */
const PATH_ALIASES: readonly { readonly prefix: string; readonly bases: readonly string[] }[] = [
  { prefix: '~~/', bases: [''] },
  { prefix: '@@/', bases: [''] },
  { prefix: '~/', bases: ['app', 'src', ''] },
  { prefix: '@/', bases: ['app', 'src', ''] },
];

// ── Pure classifiers ───────────────────────────────────────────────────

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(basename(path));
}

/**
 * An assertion counts only when it is *code*. The regex used to run over
 * the raw bytes, so `// TODO: expect(bar(1)).toBe(2)` certified a file
 * whose function nothing calls — and the placeholder test carrying that
 * comment also escaped the assertion-free rule, so one line broke both
 * halves of the contract at once. `const help = "call expect(x) here"`
 * was the same hole with quotes instead of a slash.
 */
export function hasAssertion(code: string): boolean {
  return ASSERTION_PATTERN.test(stripCommentsAndStrings(code));
}

export function isConfigFile(path: string): boolean {
  return CONFIG_FILE_PATTERN.test(basename(path));
}

// ── "does an assertion EXECUTE" ────────────────────────────────────────
//
// `hasAssertion` answers "is there an `expect(` in this file's code", and
// the whole gate used to rest on that answer. `bun test` runs zero
// assertions over a `test.skip` body and zero over a function nothing
// calls, so both spellings certified a module while proving nothing about
// it — and both hid the file carrying them from the assertion-free rule,
// exactly as the commented-out `expect(` did before it. The question the
// gate actually means to ask is whether a test *reaches* an assertion.
//
// This is a static approximation, and it is deliberately the conservative
// one: an assertion counts unless the file's own structure shows it cannot
// run. Two structures show that, and they are the two that occur:
//
//   - it sits inside a registration `bun test` will not execute
//     (`test.skip`, `it.skip`, `describe.skip`, `test.todo`, `xit`,
//     `xdescribe`, `xtest`), or inside a hook in a file where every test
//     is skipped;
//   - it sits in the body of a *named* function — `function f() {…}`,
//     `const f = () => {…}` — whose name nothing executing ever mentions.
//
// Anything else counts: a bare assertion in a test callback, in a
// `describe` body, at module scope, or inside an anonymous callback. A
// name mentioned anywhere that runs makes its function reachable, and
// reachability is transitive, so a helper chain is credited the way the
// runtime credits it.

/** Registrars whose callback is a test body `bun test` executes. */
const TEST_REGISTRARS = new Set(['test', 'it', 'bench']);
/** Registrars that run only because some test in the same file runs. */
const HOOK_REGISTRARS = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach']);
/**
 * A registration call. The lookbehind is what keeps `RE.test(s)` — which
 * every one of these check scripts writes — from reading as a test.
 */
const REGISTRAR_CALL =
  /(?<![.\w$])(x?)(test|it|bench|describe|suite|beforeAll|beforeEach|afterAll|afterEach)((?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
/** Only the unconditional forms. `.skipIf(cond)` may well run, so it counts. */
const SKIPPING_MODIFIERS = new Set(['skip', 'todo']);
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const NAMED_FUNCTION_DECLARATION = /(?<![.\w$])function\s*\*?\s*([A-Za-z_$][\w$]*)/g;
const NAMED_FUNCTION_BINDING = /(?<![.\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;

interface Span {
  readonly start: number;
  readonly end: number;
}

/** Index just past the delimiter matching the one opening at `open`. */
function matchDelimiter(code: string, open: number, closeChar: string): number {
  const openChar = code[open]!;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === openChar) depth += 1;
    else if (code[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return code.length;
}

function inAnySpan(spans: readonly Span[], index: number): boolean {
  return spans.some((s) => index >= s.start && index < s.end);
}

/** The identifiers appearing in `text`, as a set. */
function identifiersIn(text: string): Set<string> {
  return new Set(text.match(IDENTIFIER) ?? []);
}

/** `code` with every one of `spans` replaced by spaces, so positions hold. */
function blankSpans(code: string, spans: readonly Span[]): string {
  if (spans.length === 0) return code;
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const span of ordered) {
    const start = Math.max(cursor, span.start, 0);
    const end = Math.min(span.end, code.length);
    if (end <= start) continue;
    out += code.slice(cursor, start) + ' '.repeat(end - start);
    cursor = end;
  }
  return out + code.slice(cursor);
}

interface Registration {
  /** The whole call, arguments included. */
  readonly span: Span;
  readonly name: string;
  readonly skipped: boolean;
}

/**
 * Every registration call in the file, with the span of its own call
 * (chained call groups included, so `test.each([…])('n', fn)` covers both).
 */
function scanRegistrations(code: string): Registration[] {
  const found: Registration[] = [];
  for (const match of code.matchAll(REGISTRAR_CALL)) {
    const [whole, xPrefix, name, chain] = match;
    const openParen = match.index + whole.length - 1;
    let end = matchDelimiter(code, openParen, ')');
    // `test.each([…])(…)` and `describe.each(…)(…)`: the arguments that
    // matter live in the second call group.
    while (code.slice(end).match(/^\s*\(/)) {
      end = matchDelimiter(code, end + code.slice(end).indexOf('('), ')');
    }
    const modifiers = (chain ?? '').split('.').filter(Boolean);
    found.push({
      span: { start: match.index, end },
      name: name!,
      skipped: xPrefix === 'x' || modifiers.some((m) => SKIPPING_MODIFIERS.has(m)),
    });
  }
  return found;
}

/**
 * The end of the function body starting at or after `from`, or `null` when
 * what follows is not a function at all. A `{` at parenthesis depth zero
 * opens a block body; a `;` before one ends a concise arrow body.
 */
function functionBodyEnd(code: string, from: number, kind: 'declaration' | 'binding'): number | null {
  let i = from;
  while (i < code.length && /\s/.test(code[i]!)) i += 1;

  if (kind === 'binding') {
    if (code.startsWith('async', i)) i += 5;
    while (i < code.length && /\s/.test(code[i]!)) i += 1;

    const isFunctionKeyword = /^function(?![\w$])/.test(code.slice(i, i + 12));
    const isParenthesised = code[i] === '(';
    const singleParam = /^[A-Za-z_$][\w$]*\s*=>/.test(code.slice(i, i + 64));
    if (!isFunctionKeyword && !isParenthesised && !singleParam) return null;

    // A parenthesised head is an arrow function only when a `=>` follows
    // it; without that test `const total = (a + b);` would read as one and
    // its body would swallow whatever came next.
    if (isParenthesised) {
      const afterParams = matchDelimiter(code, i, ')');
      if (!/^\s*(?::[^=;]*)?=>/.test(code.slice(afterParams, afterParams + 96))) return null;
    }
  }

  let parens = 0;
  for (let j = i; j < code.length; j += 1) {
    const c = code[j]!;
    if (c === '(') parens += 1;
    else if (c === ')') parens -= 1;
    else if (parens === 0) {
      if (c === '{') return matchDelimiter(code, j, '}');
      if (c === ';') return j;
    }
  }
  return code.length;
}

/** Every named function-like declaration in the file, by name. */
function namedFunctionSpans(code: string): Map<string, Span[]> {
  const byName = new Map<string, Span[]>();
  const add = (name: string, span: Span): void => {
    const list = byName.get(name) ?? [];
    list.push(span);
    byName.set(name, list);
  };

  for (const match of code.matchAll(NAMED_FUNCTION_DECLARATION)) {
    const end = functionBodyEnd(code, match.index + match[0].length, 'declaration');
    if (end !== null) add(match[1]!, { start: match.index, end });
  }
  for (const match of code.matchAll(NAMED_FUNCTION_BINDING)) {
    const end = functionBodyEnd(code, match.index + match[0].length, 'binding');
    if (end !== null) add(match[1]!, { start: match.index, end });
  }
  return byName;
}

/**
 * True when at least one `expect(`/`assert(` in this file is reached by
 * something `bun test` executes. See the block comment above for what
 * "reached" means and why it is measured this way.
 */
export function hasExecutingAssertion(code: string): boolean {
  const stripped = stripCommentsAndStrings(code);
  if (!ASSERTION_PATTERN.test(stripped)) return false;

  const registrations = scanRegistrations(stripped);
  const dead: Span[] = registrations.filter((r) => r.skipped).map((r) => r.span);
  const liveTests = registrations.filter(
    (r) => TEST_REGISTRARS.has(r.name) && !r.skipped && !inAnySpan(dead, r.span.start),
  );
  // A hook body runs only because a test does. When every test in the file
  // is skipped, `beforeEach(() => expect(…))` runs as little as they do.
  if (liveTests.length === 0) {
    for (const registration of registrations) {
      if (HOOK_REGISTRARS.has(registration.name)) dead.push(registration.span);
    }
  }

  const functions = namedFunctionSpans(stripped);
  const allFunctionSpans = [...functions.values()].flat();

  // Reachability: seed with every name mentioned outside a function body
  // and outside dead code — that is, everything the module executes on its
  // own — then follow the names those functions mention, transitively.
  const reachable = new Set<string>();
  const queue = [...identifiersIn(blankSpans(stripped, [...dead, ...allFunctionSpans]))].filter((n) =>
    functions.has(n),
  );
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (reachable.has(name)) continue;
    reachable.add(name);
    for (const span of functions.get(name) ?? []) {
      if (inAnySpan(dead, span.start)) continue;
      const body = blankSpans(
        stripped.slice(span.start, span.end),
        dead.map((d) => ({ start: d.start - span.start, end: d.end - span.start })),
      );
      for (const mentioned of identifiersIn(body)) {
        if (functions.has(mentioned) && !reachable.has(mentioned)) queue.push(mentioned);
      }
    }
  }

  const unreachableSpans = [...functions]
    .filter(([name]) => !reachable.has(name))
    .flatMap(([, spans]) => spans);

  for (const match of stripped.matchAll(ASSERTION_PATTERN_GLOBAL)) {
    if (inAnySpan(dead, match.index)) continue;
    if (inAnySpan(unreachableSpans, match.index)) continue;
    return true;
  }
  return false;
}

/**
 * X3, the structural half. `<tool>.config.ts` is a *name*, and this file's
 * header promises exemptions are mechanical rather than by name — so the
 * name alone exempted any `*.config.ts` anywhere under a member, a
 * hypothetical `packages/core/src/retry.config.ts` holding real backoff
 * logic included. What actually makes a file tool configuration is
 * structural: the tool loads it by path, so no module in the repository
 * imports it. A `*.config.ts` that some module imports is a module.
 *
 * `importedBySource` holds only imports written in NON-test source. A
 * config a test imports is covered by E1 anyway, and would fail here for
 * the wrong reason.
 */
export function isToolConfig(path: string, importedBySource: ReadonlySet<string>): boolean {
  return isConfigFile(path) && !importedBySource.has(path);
}

/**
 * `/` opens a regular expression only where a value cannot already have
 * ended. `<` and `>` are deliberately absent: they would read `</p>` in a
 * `.vue` template as the start of one and swallow the markup to the next
 * slash, and `a < /re/.test(b)` is not a thing anyone writes.
 */
const REGEX_MAY_FOLLOW = /(?:[([{,;:=!&|?+\-*%~^]|\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await))$/;

/**
 * One pass over the source, blanking what is not executable code:
 * comments always, and string/template contents when `blankStrings` is
 * set. Regular-expression literals are recognised so that a quote or a
 * `//` inside one (`/["']/`) neither opens a string nor eats the rest of
 * the line.
 *
 * There is exactly one of these because there is exactly one fact here —
 * "which bytes of this file are code". `stripComments` and
 * `stripCommentsAndStrings` are two questions asked of it, not two
 * implementations of it: `isBarrel`/`scanReExports`/`scanImportRecords`
 * need the string CONTENTS (module specifiers live in them), and
 * `hasAssertion` must not see them.
 */
function blankNonCode(code: string, blankStrings: boolean): string {
  let out = '';
  // One frame per nesting level. A template literal's `${…}` opens a code
  // frame, so an assertion written inside one is still an assertion.
  const frames: Array<{ kind: 'code' | 'template'; braces: number }> = [{ kind: 'code', braces: 0 }];
  let i = 0;

  while (i < code.length) {
    const frame = frames[frames.length - 1]!;
    const ch = code[i]!;

    if (frame.kind === 'template') {
      if (ch === '\\') {
        if (!blankStrings) out += code.slice(i, i + 2);
        i += 2;
      } else if (ch === '`') {
        out += '`';
        frames.pop();
        i += 1;
      } else if (ch === '$' && code[i + 1] === '{') {
        out += '${';
        frames.push({ kind: 'code', braces: 0 });
        i += 2;
      } else {
        if (!blankStrings) out += ch;
        i += 1;
      }
      continue;
    }

    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = code.indexOf('*/', i + 2);
      i = close === -1 ? code.length : close + 2;
      continue;
    }
    if (ch === '/' && REGEX_MAY_FOLLOW.test(out.slice(-16).trimEnd())) {
      i += 1;
      let inClass = false;
      while (i < code.length) {
        const c = code[i]!;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '\n') break;
        i += 1;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
      }
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") {
      out += ch;
      i += 1;
      while (i < code.length && code[i] !== ch && code[i] !== '\n') {
        if (code[i] === '\\') {
          if (!blankStrings) out += code.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (!blankStrings) out += code[i];
        i += 1;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '`') {
      out += '`';
      frames.push({ kind: 'template', braces: 0 });
      i += 1;
      continue;
    }
    if (ch === '{') {
      frame.braces += 1;
    } else if (ch === '}') {
      // The `}` that closes a `${…}` substitution hands the frame back to
      // the template that opened it.
      if (frame.braces === 0 && frames.length > 1) {
        out += '}';
        frames.pop();
        i += 1;
        continue;
      }
      frame.braces -= 1;
    }
    out += ch;
    i += 1;
  }

  return out;
}

function stripComments(code: string): string {
  return blankNonCode(code, false);
}

function stripCommentsAndStrings(code: string): string {
  return blankNonCode(code, true);
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

/**
 * `import './x'` (side effect), and `import`/`export … from '…'` with the
 * clause captured. The clause may not contain a quote, a backtick or a
 * semicolon, which is what keeps it from running past the end of its own
 * statement.
 */
const MODULE_STATEMENT =
  /\bimport\s*["']([^"']+)["']|\b(?:import|export)\s+([^;"'`]*?)\s*\bfrom\s*["']([^"']+)["']/g;

/**
 * The value bindings a clause brings in, and whether it brings in any
 * value at all.
 *
 * A type-only clause brings in nothing. `import type { X } from './x'`
 * erases at compile time and cannot exercise a line of `./x`, so it is not
 * evidence — and neither is `import { type X }`, `import type X from`
 * (default), `export type { X } from`, `export type * from`, or a brace
 * clause whose every specifier carries an inline `type`: all of them
 * erase. This is the exact mirror of the hole `core-purity.ts` documents,
 * where `Bun.Transpiler().scanImports()` elides these and a raw scan had
 * to be added to see them; here they were counted where they must not be.
 */
function parseModuleClause(clause: string): { readonly names: string[]; readonly importsValues: boolean } {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return { names: [], importsValues: false };

  const braced = /\{([^}]*)\}/.exec(trimmed);
  // Whatever sits outside the braces is a default binding, a `* as ns`, or
  // a bare `*` — every one of them a value.
  const outside = trimmed.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();

  const names: string[] = [];
  for (const raw of braced?.[1]?.split(',') ?? []) {
    const specifier = raw.trim();
    if (!specifier || /^type\b/.test(specifier)) continue;
    const name = specifier.split(/\s+as\s+/)[0]?.trim();
    if (name) names.push(name);
  }

  return { names, importsValues: outside.length > 0 || names.length > 0 };
}

/**
 * Every module specifier this file actually pulls a value from, with the
 * names taken through it. A statement that erases at compile time produces
 * no record at all — not even a bare specifier, or E1 would credit the
 * target on the strength of an import that never runs.
 */
export function scanImportRecords(code: string): ImportRecord[] {
  const bySpecifier = new Map<string, Set<string>>();

  for (const [, sideEffect, clause, specifier] of stripComments(code).matchAll(MODULE_STATEMENT)) {
    if (sideEffect !== undefined) {
      if (!bySpecifier.has(sideEffect)) bySpecifier.set(sideEffect, new Set());
      continue;
    }
    const { names, importsValues } = parseModuleClause(clause ?? '');
    if (!importsValues) continue;
    const set = bySpecifier.get(specifier!) ?? new Set<string>();
    for (const name of names) set.add(name);
    bySpecifier.set(specifier!, set);
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
  /export\s+(type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

/**
 * The map `credit()` walks a barrel by. Type-only re-exports are left out
 * of it in both spellings — `export type { X } from '…'` and the inline
 * `export { type X } from '…'` — so a type name can never be carried
 * through a barrel to credit the module that declares it. `scanImportRecords`
 * already drops such names on the way in; this is the same fact stated
 * where the walk happens, because a barrel is the one place a name arrives
 * without the statement that introduced it.
 */
export function scanReExports(code: string): ReExportMap {
  const named = new Map<string, string>();
  const wildcards: string[] = [];

  for (const [, typeOnly, clause, specifier] of stripComments(code).matchAll(RE_EXPORT_WITH_TARGET)) {
    if (typeOnly) continue;
    if (clause!.startsWith('*')) {
      wildcards.push(specifier!);
      continue;
    }
    for (const raw of clause!.slice(1, -1).split(',')) {
      const trimmed = raw.trim();
      if (!trimmed || /^type\b/.test(trimmed)) continue;
      const parts = trimmed.split(/\s+as\s+/);
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

/** The nearest ancestor of `file` holding a `package.json`, bounded by `root`. */
function packageRootOf(file: string, root: string): string | null {
  let dir = dirname(file);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir || dir.length <= root.length) return null;
    dir = parent;
  }
}

/**
 * A `#…` specifier, resolved the way Node resolves it: through the
 * `imports` map of the nearest `package.json`, exact keys and one `*`
 * wildcard. Nothing else — `#app`, `#components` and `#imports` are Nuxt's
 * virtual modules, and no file in this repository answers to them.
 * Guessing a directory for them would be worse than useless: `#app` would
 * land on `apps/web/app/app.vue` and credit a component nobody imported.
 */
function resolveSubpathImport(pkgRoot: string, specifier: string, manifest: Record<string, unknown>): string | null {
  const imports = manifest.imports;
  if (typeof imports !== 'object' || imports === null) return null;

  for (const [pattern, rawTarget] of Object.entries(imports as Record<string, unknown>)) {
    const target = typeof rawTarget === 'string' ? rawTarget : null;
    if (!target) continue;
    if (!pattern.includes('*')) {
      if (pattern === specifier) return resolveFile(resolve(pkgRoot, target));
      continue;
    }
    const [head, tail = ''] = pattern.split('*');
    if (!specifier.startsWith(head!) || !specifier.endsWith(tail) || specifier.length < head!.length + tail.length) {
      continue;
    }
    const filled = specifier.slice(head!.length, specifier.length - tail.length);
    const hit = resolveFile(resolve(pkgRoot, target.replace('*', filled)));
    if (hit) return hit;
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
  rootArg: string,
  allowList: readonly Exemption[] = ALLOW_LIST,
): TestCoverageResult {
  // `resolveSpecifier` always produces absolute paths, while `walk`
  // inherits whatever shape the root was given. Under a relative root the
  // two never met, so E1/E2 credited nothing and only sibling-tested files
  // survived — `bun run scripts/checks/test-coverage.ts .` reported nine
  // files that the same check run with no argument does not.
  const root = resolve(rootArg);
  const errors: string[] = [];
  const memberDirs = findMemberDirs(root);
  const scanRoots = [...memberDirs, ...EXTRA_SOURCE_ROOTS.map((dir) => join(root, dir))];
  const allFiles = scanRoots.flatMap((dir) => walk(dir));
  const testFiles = allFiles.filter(isTestFile);
  const sourceFiles = allFiles.filter((f) => !isTestFile(f));
  const entryPoints = workspaceEntryPoints(memberDirs);

  const sources = new Map<string, string>();
  const sourceOf = (file: string): string => {
    let code = sources.get(file);
    if (code === undefined) {
      code = readFileSync(file, 'utf8');
      sources.set(file, code);
    }
    return code;
  };

  const facts = new Map<string, FileFacts>();
  const factsFor = (file: string): FileFacts => {
    let cached = facts.get(file);
    if (!cached) {
      const code = sourceOf(file);
      cached = { barrel: isBarrel(code), reExports: scanReExports(code) };
      facts.set(file, cached);
    }
    return cached;
  };

  const rel = (file: string): string => relative(root, file).split('\\').join('/');

  const packageRoots = new Map<string, string | null>();
  const packageRootFor = (file: string): string | null => {
    const dir = dirname(file);
    let cached = packageRoots.get(dir);
    if (cached === undefined) {
      cached = packageRootOf(file, root);
      packageRoots.set(dir, cached);
    }
    return cached;
  };

  const manifests = new Map<string, Record<string, unknown>>();
  const manifestOf = (pkgRoot: string): Record<string, unknown> => {
    let cached = manifests.get(pkgRoot);
    if (!cached) {
      try {
        cached = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
      } catch {
        cached = {};
      }
      manifests.set(pkgRoot, cached);
    }
    return cached;
  };

  /** Resolve a specifier written inside `fromFile` to a file in this repository. */
  const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
    if (specifier.startsWith('.')) return resolveFile(resolve(dirname(fromFile), specifier));
    if (specifier.startsWith(WORKSPACE_SCOPE)) return entryPoints.get(specifier) ?? null;

    // An alias is a path (see PATH_ALIASES). Resolved here so the config
    // exemption cannot be bought by changing how an import is spelled.
    // Everything else is a bare package name from node_modules, and is
    // rejected before the walk up to a package root: that walk used to run
    // for `vue` and `zod` too, once per import in the repository.
    const alias = PATH_ALIASES.find((a) => specifier.startsWith(a.prefix));
    if (!alias && !specifier.startsWith('#')) return null;

    const pkgRoot = packageRootFor(fromFile);
    if (!pkgRoot) return null;
    if (!alias) return resolveSubpathImport(pkgRoot, specifier, manifestOf(pkgRoot));
    const rest = specifier.slice(alias.prefix.length);
    for (const base of alias.bases) {
      const hit = resolveFile(join(pkgRoot, base, rest));
      if (hit) return hit;
    }
    return null;
  };

  // X3's structural half: what non-test source actually imports. A
  // `*.config.ts` some module imports is a module, not tool configuration.
  const importedBySource = new Set<string>();
  for (const file of sourceFiles) {
    for (const record of scanImportRecords(sourceOf(file))) {
      const target = resolveSpecifier(file, record.specifier);
      if (target) importedBySource.add(target);
    }
  }

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

  const executes = new Map<string, boolean>();
  const executesAnAssertion = (testFile: string): boolean => {
    let cached = executes.get(testFile);
    if (cached === undefined) {
      cached = hasExecutingAssertion(sourceOf(testFile));
      executes.set(testFile, cached);
    }
    return cached;
  };

  for (const testFile of testFiles) {
    const code = sourceOf(testFile);
    if (!executesAnAssertion(testFile)) {
      errors.push(
        `${rel(testFile)}: test file runs no assertion (no expect()/assert() call a test reaches) — ` +
          `a skipped test and an assertion nothing calls are not coverage, and this file counts as ` +
          `evidence for nothing`,
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
    if (!executesAnAssertion(testFile)) continue;
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
    if (isToolConfig(file, importedBySource)) return 'exempt';
    const code = sourceOf(file);
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

  // The member-level rule, restored. `CLAUDE.md` and `.githooks/pre-commit`
  // have both promised since Phase 0 that `bun run check` fails when "a
  // workspace member has no executing test". The per-file rewrite replaced
  // the mechanism and kept the sentence, so a member could declare
  // `"test": "echo no tests"` and ship green — the file-level rule says
  // nothing about a member whose files all happen to be exempt, and
  // nothing at all about whether `bun run -F <member> test` runs a runner.
  // A documented guarantee nobody enforces is worse than no guarantee,
  // because people plan around it.
  for (const memberDir of memberDirs) {
    const relMember = rel(memberDir);
    const manifest = manifestOf(memberDir);
    const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
    const testScript = typeof scripts.test === 'string' ? scripts.test : null;

    if (!testScript) {
      errors.push(`${relMember}: package.json declares no \`test\` script — every workspace member must run tests`);
    } else if (!TEST_RUNNER_PATTERN.test(testScript)) {
      errors.push(
        `${relMember}: its \`test\` script (${JSON.stringify(testScript)}) invokes no test runner — ` +
          `it must run \`bun test\` or \`vitest\`, or the member is green for having said nothing`,
      );
    }

    const memberTests = testFiles.filter((f) => f.startsWith(`${memberDir}/`));
    if (!memberTests.some(executesAnAssertion)) {
      errors.push(
        `${relMember}: contains no test file that runs an assertion — the member has no executing test`,
      );
    }
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

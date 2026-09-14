/**
 * Structural check: `packages/core` stays framework-free. Every specifier
 * imported by its non-test source files must be relative (no framework,
 * no Bun-specific API, not even a Node built-in), its non-test source
 * files must not reach a runtime through an ambient global either, and its
 * manifest must declare zero runtime dependencies. Uses
 * `Bun.Transpiler().scanImports()` for AST-accurate detection of `import`,
 * `import()`, and `require` specifiers — no ESLint plugin, and no inline
 * disable comment can silence it (design.md D3).
 *
 * ── Three evasions this check used to pass, closed here ────────────────
 *
 *  1. `import { type Root, type Content } from 'mdast'`. `scanImports()`
 *     elides an inline-`type` specifier exactly as it elides `import type
 *     … from` (measured, see the test), and the supplementary regex
 *     required the `type` keyword *before* the clause. Both mechanisms
 *     were blind to the same line. The backstop below no longer asks
 *     whether an import is type-only: it sweeps **every** static
 *     `import`/`export … from` specifier, whatever the clause says.
 *
 *  2. `process.env.HOME`, `Buffer.from(…)` — no import at all. "Not even
 *     a Node built-in" was enforced only against import specifiers, and
 *     the globals that make the built-in unnecessary are ambient. A
 *     domain layer that reads the environment is bound to a runtime just
 *     as surely as one that imports `node:process`. See
 *     `FORBIDDEN_GLOBALS`.
 *
 *  3. `src/helper.mts` importing `hono`. `SOURCE_FILE_PATTERN` read only
 *     `.ts`/`.tsx`, so the file was never opened — it did not exist as
 *     far as this check was concerned. Every extension Bun, tsc and Node
 *     execute is read now.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface CorePurityResult {
  ok: boolean;
  errors: string[];
}

/**
 * Every extension Bun, tsc and Node execute — not just the two this check
 * used to read. `.mts`/`.cts` are first-class TypeScript modules; a `.js`
 * or `.mjs` file under `packages/core/src` is source too.
 */
const SOURCE_FILE_PATTERN = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The transpiler loader for a given source extension. */
function loaderFor(file: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  switch (extname(file)) {
    case '.tsx':
      return 'tsx';
    case '.jsx':
      return 'jsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'js';
    default:
      return 'ts';
  }
}
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

function isRelativeSpecifier(path: string): boolean {
  return path.startsWith('.') || path.startsWith('/');
}

function findSourceFiles(dir: string): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (SOURCE_FILE_PATTERN.test(entry) && !TEST_FILE_PATTERN.test(entry)) {
        found.push(full);
      }
    }
  }

  walk(dir);
  return found;
}

export interface CoreManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * `dependencies` alone is not enough. `scanImports()` elides type-only imports
 * (measured), so a framework reached for as `import type` is invisible to the
 * AST scan — and if that framework were declared only under `devDependencies`,
 * nothing here would have seen it either. Both holes had to be open at once for
 * a framework to reach packages/core unnoticed, and both were.
 *
 * Pure so it can be tested without a filesystem.
 */
export function checkManifest(pkg: CoreManifest): CorePurityResult {
  const deps = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];

  return deps.length === 0
    ? { ok: true, errors: [] }
    : {
        ok: false,
        errors: [
          `package.json declares dependencies (${deps.join(', ')}); packages/core must depend on ` +
            `nothing, including under devDependencies or peerDependencies`,
        ],
      };
}

/**
 * `Bun.Transpiler().scanImports()` elides type-only imports (measured — see
 * `core-purity.test.ts`'s "type-only imports" suite), and it elides an
 * *inline* `type` specifier too: `import { type Root } from 'mdast'` scans
 * to `[]` exactly as `import type { Root } from 'mdast'` does.
 *
 * The previous backstop asked for the `type` keyword before the clause, so
 * the inline form fell between the two mechanisms and reached
 * `packages/core` unseen. This one asks nothing about the clause at all: it
 * sweeps **every** static `import`/`export … from "…"` specifier, plus the
 * bare side-effect form `import "…"`. Whatever `scanImports()` does or does
 * not consider a "real" import, a module specifier written in the source is
 * caught here (D19: no mdast type crosses into packages/core, ever).
 */
const STATIC_SPECIFIER_PATTERN = /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;
const BARE_IMPORT_PATTERN = /^[ \t]*import\s+["']([^"']+)["']/gm;

export function findStaticSpecifiers(code: string): string[] {
  // Comments only — the specifier *is* a string literal, so stripping
  // strings here would erase the very thing being looked for.
  const source = stripComments(code);
  const specifiers: string[] = [];
  for (const pattern of [STATIC_SPECIFIER_PATTERN, BARE_IMPORT_PATTERN]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/**
 * Ambient globals that bind a file to a runtime without an import.
 *
 * "packages/core must import nothing, not even a Node built-in" was enforced
 * only against import specifiers — and `process.env.HOME` and
 * `Buffer.from(…)` need no specifier: they are ambient in Node and Bun. A
 * domain layer that reads the environment, allocates a Buffer or calls
 * `crypto.randomUUID()` is bound to a runtime just as surely as one that
 * imports `node:process`, and every one of those capabilities belongs behind
 * a port in `src/ports/` (that is what `password-hasher.ts` already does for
 * `Bun.password`).
 *
 * The DOM half is here for the same reason from the other direction:
 * `packages/core` is imported by `apps/api` (server) and, through
 * `packages/contracts`, by `apps/web` (browser). A file that reaches for
 * `window` or `document` cannot run on the server; one that reaches for
 * `process` cannot run in the browser. Neither may exist here.
 */
const FORBIDDEN_GLOBALS: readonly string[] = [
  // Node / Bun runtime
  'process',
  'Buffer',
  '__dirname',
  '__filename',
  'global',
  'require',
  'module',
  'Bun',
  'setImmediate',
  'crypto',
  // Browser runtime
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
];

/**
 * Removes what is not code before the global sweep runs over it.
 *
 * This matters more than it looks. Every occurrence of `Bun`, `process`,
 * `crypto`, `window` and `module` in `packages/core` today is prose inside a
 * doc comment — "Argon2id via `Bun.password`", "no assumption about process
 * topology", "inside a time window". A check that cannot tell prose from
 * code would flag all of them, and a check that flags a doc comment gets
 * turned off.
 *
 * Known limit, stated rather than hidden: a template literal that contains a
 * `${…}` substitution is left intact, so its literal text is scanned as if
 * it were code. That direction is deliberate — it can only ever produce a
 * loud false positive, never a silent miss, and the substitution's real code
 * has to stay visible.
 */
export function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function stripCommentsAndStrings(code: string): string {
  return (
    stripComments(code)
      // Template literals with no substitution only: one carrying `${…}` keeps
      // its code visible (see the doc comment above).
      .replace(/`(?:[^`\\$]|\\[\s\S]|\$(?!\{))*`/g, ' ')
      .replace(/'(?:[^'\\\n]|\\[\s\S])*'/g, ' ')
      .replace(/"(?:[^"\\\n]|\\[\s\S])*"/g, ' ')
  );
}

/**
 * Identifiers the file declares itself. A local named `document` or `module`
 * shadows the global and is nobody's business but the file's; without this,
 * the sweep below would report a variable for the sin of its name.
 */
function locallyDeclared(source: string): Set<string> {
  const declared = new Set<string>();
  const pattern = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) declared.add(match[1]);
  }
  return declared;
}

/**
 * Every forbidden global actually *used* in `code` — used, not merely named.
 * A bare identifier in a type position (`typeof process`) still counts: it
 * still asserts the runtime is there.
 */
export function findForbiddenGlobals(code: string): string[] {
  const source = stripCommentsAndStrings(code);
  const declared = locallyDeclared(source);
  const found = new Set<string>();

  for (const name of FORBIDDEN_GLOBALS) {
    if (declared.has(name)) continue;
    // Not preceded by `.` (a property of something else), `?.`, or a word
    // character; followed by a property access, a call, or an index — the
    // shapes in which a global is actually reached for.
    const pattern = new RegExp(String.raw`(?<![.?\w$])${name}\s*(?=[.([])`);
    if (pattern.test(source)) found.add(name);
  }

  return [...found];
}

export function checkCorePurity(coreDir: string): CorePurityResult {
  const errors: string[] = [];

  const pkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')) as CoreManifest;
  errors.push(...checkManifest(pkg).errors);

  const srcDir = join(coreDir, 'src');
  for (const file of findSourceFiles(srcDir)) {
    const code = readFileSync(file, 'utf8');
    const transpiler = new Bun.Transpiler({ loader: loaderFor(file) });
    const rel = relative(coreDir, file);

    const specifiers = new Set<string>([
      ...transpiler.scanImports(code).map((imp) => imp.path),
      ...findStaticSpecifiers(code),
    ]);

    for (const specifier of specifiers) {
      if (!isRelativeSpecifier(specifier)) {
        errors.push(
          `${rel}: disallowed non-relative import "${specifier}" (packages/core must import nothing but its own relative modules — including \`import type\`, \`export type\` and an inline \`{ type X }\` specifier, none of which scanImports() reports)`,
        );
      }
    }

    for (const name of findForbiddenGlobals(code)) {
      errors.push(
        `${rel}: reaches for the ambient global \`${name}\` (packages/core must import nothing, not even a Node built-in — and a global needs no import to bind this file to a runtime; put the capability behind a port in src/ports/ instead)`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const target = process.argv[2] ?? join(process.cwd(), 'packages', 'core');
  const result = checkCorePurity(target);
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`core-purity: ${err}`);
    }
    process.exit(1);
  }
  console.log('core-purity: ok');
}

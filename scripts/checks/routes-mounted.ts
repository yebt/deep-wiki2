/**
 * Structural check: every route module is actually reachable.
 *
 * This defect has now shipped twice. In Phase 1, `admin`, `invitations` and
 * `uploads` were fully implemented and unit-tested while `apps/api`'s
 * composition root wired only `createAuthRoutes` — every test passed and no
 * browser could reach any of them. In Phase 5 the same thing happened to
 * `ai-credentials`.
 *
 * Unit tests cannot catch it: they invoke the route factory directly and
 * never go through the running server. Neither can typecheck, because an
 * unmounted module is still a valid module. The only signal is a request
 * that never arrives, which surfaces days later as "the API is down".
 *
 * **The composition root is read as code, not as prose.** Comments and
 * string literals are stripped before matching, so `// TODO: mount
 * createAdminRoutes` — precisely the artefact a developer leaves *because*
 * the module is not wired yet — no longer satisfies the rule. What counts
 * is an identifier reference (the import binding, the call, or both);
 * matching is whole-identifier, so `createAdminRoutesLegacy` does not
 * mount `createAdminRoutes`.
 *
 * **Limits.** `stripCommentsAndStrings` is a scanner, not a parser: a
 * regular-expression literal containing an unbalanced quote or comment
 * marker can confuse it, and brace matching inside a `${…}` substitution
 * ignores braces that appear inside nested strings. Both are rare in a
 * composition root, and the failure mode is a false "unmounted" report —
 * loud, not silent.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RoutesMountedResult {
  ok: boolean;
  errors: string[];
}

/**
 * `createFooRoutes` / `createFooRoute` exported from a route module, in
 * either spelling a factory is actually written in: a function
 * declaration, or a `const`/`let`/`var` binding holding an arrow function.
 * A check that knows only `export function` silently exempts every module
 * that reached for the other one.
 */
const FACTORY_PATTERNS: readonly RegExp[] = [
  /export\s+(?:async\s+)?function\s+(create[A-Za-z0-9_]*Routes?)\s*[(<]/g,
  /export\s+(?:const|let|var)\s+(create[A-Za-z0-9_]*Routes?)\s*(?::|=)/g,
];

/**
 * Removes comments and string/template literal *contents* while keeping
 * the code around them — including the contents of a `${…}` substitution,
 * where a real call can legitimately live.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += ' ';
      continue;
    }

    if (ch === '`') {
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '`') {
          i += 1;
          break;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2;
          const start = i;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            if (depth > 0) i += 1;
          }
          out += ` ${stripCommentsAndStrings(source.slice(start, i))} `;
          i += 1;
          continue;
        }
        i += 1;
      }
      out += ' ';
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function factoriesIn(source: string): string[] {
  const code = stripCommentsAndStrings(source);
  const names: string[] = [];
  for (const pattern of FACTORY_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      if (match[1] && !names.includes(match[1])) names.push(match[1]);
    }
  }
  return names;
}

/** Whole-identifier reference, so `createAdminRoutesLegacy` never mounts `createAdminRoutes`. */
function referencesIdentifier(code: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`).test(code);
}

export function checkMounted(
  routeModules: ReadonlyMap<string, string>,
  compositionRoot: string,
): RoutesMountedResult {
  const errors: string[] = [];
  // Prose is not a mount: a name that survives only inside a comment or a
  // string literal is a note about the missing wiring, not the wiring.
  const rootCode = stripCommentsAndStrings(compositionRoot);

  for (const [file, source] of routeModules) {
    for (const factory of factoriesIn(source)) {
      if (!referencesIdentifier(rootCode, factory)) {
        errors.push(
          `${file} exports ${factory}() but apps/api/src/index.ts never references it. ` +
            `The routes are unreachable from a running server, and unit tests cannot see that ` +
            `because they call the factory directly.`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

const MODULE_EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__fixtures__', '__mocks__']);

function isRouteModule(entry: string): boolean {
  if (!MODULE_EXTENSIONS.some((ext) => entry.endsWith(ext))) return false;
  return !/\.(test|spec)\.tsx?$/.test(entry) && !entry.endsWith('.d.ts');
}

/**
 * Reads every route module under `routesDir`, **recursively**. The
 * non-recursive `readdirSync` this replaced never opened
 * `routes/admin/users.ts` at all: a whole nested route directory could be
 * unmounted and the check still reported ok, because it had not read a
 * single byte of it.
 *
 * `displayPrefix` is the path the errors quote, so a fixture tree can be
 * driven through the same code path the CLI uses.
 */
export function collectRouteModules(
  routesDir: string,
  displayPrefix = 'apps/api/src/routes',
): Map<string, string> {
  const modules = new Map<string, string>();

  function walk(dir: string, relative: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(full, rel);
      else if (isRouteModule(entry.name)) modules.set(`${displayPrefix}/${rel}`, readFileSync(full, 'utf8'));
    }
  }

  walk(routesDir, '');
  return modules;
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const routesDir = join(root, 'apps/api/src/routes');
  const rootFile = join(root, 'apps/api/src/index.ts');

  const result = checkMounted(collectRouteModules(routesDir), readFileSync(rootFile, 'utf8'));
  if (!result.ok) {
    for (const err of result.errors) console.error(`routes-mounted: ${err}`);
    process.exit(1);
  }
  console.log('routes-mounted: ok');
}

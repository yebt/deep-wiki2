/**
 * Structural check: `packages/core` stays framework-free. Every specifier
 * imported by its non-test source files must be relative (no framework,
 * no Bun-specific API, not even a Node built-in), and its manifest must
 * declare zero runtime dependencies. Uses `Bun.Transpiler().scanImports()`
 * for AST-accurate detection of `import`, `import()`, and `require`
 * specifiers — no ESLint plugin, and no inline disable comment can silence
 * it (design.md D3).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface CorePurityResult {
  ok: boolean;
  errors: string[];
}

const SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

function isRelativeSpecifier(path: string): boolean {
  return path.startsWith('.') || path.startsWith('/');
}

/**
 * Rule 3 (design.md D16): a raw source-text scan for `from '<non-relative>'`
 * and `require('<non-relative>')`, evaluated against the file's own text
 * rather than the transpiled import list. `scanImports()` was measured to
 * elide type-only specifiers — `import type { X } from 'ai'` and
 * `import { type X } from 'ai'` both vanish before the AST scan ever sees
 * them. This pass does not depend on that hole staying closed anywhere
 * else; it reads the bytes on disk. It runs alongside `scanImports()`, not
 * instead of it — the AST pass keeps its precision on dynamic `import()`
 * forms this text pass does not attempt to parse.
 */
const FROM_CLAUSE_PATTERN = /\bfrom\s+(['"])([^'"]+)\1/g;
const REQUIRE_CALL_PATTERN = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;

function scanRawSpecifiers(code: string): string[] {
  const specifiers: string[] = [];

  for (const match of code.matchAll(FROM_CLAUSE_PATTERN)) {
    const specifier = match[2];
    if (specifier) specifiers.push(specifier);
  }
  for (const match of code.matchAll(REQUIRE_CALL_PATTERN)) {
    const specifier = match[2];
    if (specifier) specifiers.push(specifier);
  }

  return specifiers;
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

export function checkCorePurity(coreDir: string): CorePurityResult {
  const errors: string[] = [];

  const pkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')) as CoreManifest;
  errors.push(...checkManifest(pkg).errors);

  const srcDir = join(coreDir, 'src');
  for (const file of findSourceFiles(srcDir)) {
    const code = readFileSync(file, 'utf8');
    const loader = extname(file) === '.tsx' ? 'tsx' : 'ts';
    const transpiler = new Bun.Transpiler({ loader });
    const imports = transpiler.scanImports(code);

    for (const imp of imports) {
      if (!isRelativeSpecifier(imp.path)) {
        errors.push(
          `${relative(coreDir, file)}: disallowed non-relative import "${imp.path}" (packages/core must import nothing but its own relative modules)`,
        );
      }
    }

    for (const specifier of scanRawSpecifiers(code)) {
      if (!isRelativeSpecifier(specifier)) {
        errors.push(
          `${relative(coreDir, file)}: disallowed non-relative specifier "${specifier}" found by the raw-source scan ` +
            `(packages/core must import nothing but its own relative modules — this catches a type-only import ` +
            `scanImports() elides)`,
        );
      }
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

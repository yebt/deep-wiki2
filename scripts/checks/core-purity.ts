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
 * `core-purity.test.ts`'s "type-only imports" suite). A supplementary raw
 * regex sweep over `import type … from "…"` and `export type … from "…"`
 * closes that gap independently of the AST scan; it cannot be fooled by
 * whatever scanImports() does or does not consider a "real" import (D19: no
 * mdast type crosses into packages/core, ever).
 */
const TYPE_ONLY_IMPORT_PATTERN = /^\s*(?:import|export)\s+type\s+[^;]*?\bfrom\s+["']([^"']+)["']/gm;

function findTypeOnlyImports(code: string): string[] {
  const specifiers: string[] = [];
  for (const match of code.matchAll(TYPE_ONLY_IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
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

    for (const specifier of findTypeOnlyImports(code)) {
      if (!isRelativeSpecifier(specifier)) {
        errors.push(
          `${relative(coreDir, file)}: disallowed non-relative type-only import "${specifier}" (packages/core must import nothing but its own relative modules, including \`import type\`/\`export type\`)`,
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

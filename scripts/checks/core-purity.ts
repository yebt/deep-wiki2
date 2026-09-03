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

export function checkCorePurity(coreDir: string): CorePurityResult {
  const errors: string[] = [];

  const pkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies ?? {});
  if (deps.length > 0) {
    errors.push(
      `package.json declares non-empty "dependencies" (${deps.join(', ')}); packages/core must depend on nothing`,
    );
  }

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

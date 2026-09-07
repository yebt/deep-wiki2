/**
 * Structural check: layer 2 of "Read mode never reaches the ProseMirror
 * bundle" (design.md). Two independent rules:
 *
 *   1. The transitive closure of `packages/editor/src/index.ts` (the "."
 *      export) must never reach `milkdown`, `@milkdown/*`, `@tiptap/*`, or
 *      any `prosemirror-*` package OTHER than `prosemirror-model` — see
 *      "Why `prosemirror-model` is allowed" below.
 *   2. No `apps/web` file may statically import `@deep-wiki/editor/mount`;
 *      only a dynamic `import()` (typically inside
 *      `defineAsyncComponent()`) is allowed, so the eager Milkdown chunk
 *      never reaches the read-mode bundle by accident.
 *
 * Walks relative imports with `Bun.Transpiler().scanImports()`, exactly as
 * `core-purity.ts` does — no bundler, no `node_modules` resolution: a
 * non-relative specifier is either flagged (forbidden) or left alone
 * (assumed fine; `single-parser.ts` and this repository's own dependency
 * graph cover what it can legitimately pull in beyond that).
 *
 * **Why `prosemirror-model` is allowed (design.md D21).** The design's own
 * prose described this layer's denylist as "milkdown, @milkdown/*,
 * prosemirror-* or @tiptap/*" — read literally, that also forbids
 * `prosemirror-model`, the pure schema/data-model package
 * `packages/editor/src/schema.ts` genuinely needs for the "." export to
 * exist at all (a ProseMirror schema without `prosemirror-model` cannot be
 * expressed). A rule that also forbids the schema's own data model is
 * over-broad: it would either block every commit or get silenced with a
 * blanket exception, and a silenced check enforces nothing. The property
 * this layer must actually hold is "read mode never loads the editing
 * surface" — the DOM-mutating view (`prosemirror-view`), key bindings
 * (`prosemirror-keymap`), commands (`prosemirror-commands`), undo history
 * (`prosemirror-history`), and Milkdown itself. `prosemirror-model` alone
 * has no DOM dependency and cannot render or edit anything; it is data
 * shapes, not a bundle-weight editing surface. Scoping the denylist this
 * way is what makes it enforceable rather than aspirational.
 * **Reversal condition**: none foreseen — `prosemirror-model`'s own scope
 * (schema/node/mark data types, no DOM) is what makes this safe, not a
 * temporary accommodation.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

export interface BundleIsolationResult {
  ok: boolean;
  errors: string[];
}

const RELATIVE_EXTENSIONS = ['.ts', '.tsx'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', '.git', 'drizzle', '__fixtures__']);

/** milkdown/@milkdown, @tiptap, or any prosemirror-* other than prosemirror-model (design D21). */
function isForbiddenEditingSurface(specifier: string): boolean {
  if (specifier === 'milkdown' || specifier.startsWith('@milkdown/')) return true;
  if (specifier.startsWith('@tiptap/')) return true;
  if (specifier.startsWith('prosemirror-') && specifier !== 'prosemirror-model') return true;
  return false;
}

function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  const base = join(dirname(fromFile), specifier);
  const candidates = [base, ...RELATIVE_EXTENSIONS.map((ext) => `${base}${ext}`), ...RELATIVE_EXTENSIONS.map((ext) => join(base, `index${ext}`))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function scanImportsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const transpiler = new Bun.Transpiler({ loader: extname(file) === '.tsx' ? 'tsx' : 'ts' });
  return transpiler.scanImports(code).map((imp) => imp.path);
}

/** Walks the "." export's transitive closure over relative imports only, flagging any forbidden non-relative specifier it reaches. */
function checkEditorClosure(root: string, errors: string[]): void {
  const entry = join(root, 'packages', 'editor', 'src', 'index.ts');
  if (!existsSync(entry)) return; // no packages/editor in this fixture/root

  const visited = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    for (const specifier of scanImportsOf(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelativeImport(file, specifier);
        if (resolved) queue.push(resolved);
        continue;
      }
      if (isForbiddenEditingSurface(specifier)) {
        errors.push(
          `${relative(root, file)}: the "." export's transitive closure reaches "${specifier}" — read mode must never load the ` +
            `Milkdown/ProseMirror editing surface (packages/editor/package.json's "./mount" export is the only legitimate place for it)`,
        );
      }
    }
  }
}

function findSourceFiles(dir: string): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (SOURCE_EXTENSIONS.has(extname(entry))) found.push(full);
    }
  }

  if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
  return found;
}

const EAGER_MOUNT_IMPORT_PATTERN = /\bimport\s+(?:type\s+)?[^;()]*\bfrom\s+['"]@deep-wiki\/editor\/mount['"]/;

/** No `apps/web` file may statically import `@deep-wiki/editor/mount` — only a dynamic `import()` is allowed. */
function checkNoEagerMountImport(root: string, errors: string[]): void {
  const webDir = join(root, 'apps', 'web');
  for (const file of findSourceFiles(webDir)) {
    const content = readFileSync(file, 'utf8');
    if (EAGER_MOUNT_IMPORT_PATTERN.test(content)) {
      errors.push(
        `${relative(root, file)}: statically imports "@deep-wiki/editor/mount" — only a dynamic import() ` +
          `(typically inside defineAsyncComponent()) is allowed, so read mode's bundle never eagerly includes Milkdown`,
      );
    }
  }
}

export function checkBundleIsolation(root: string): BundleIsolationResult {
  const errors: string[] = [];

  checkEditorClosure(root, errors);
  checkNoEagerMountImport(root, errors);

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const target = process.argv[2] ?? process.cwd();
  const result = checkBundleIsolation(target);
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`bundle-isolation: ${err}`);
    }
    process.exit(1);
  }
  console.log('bundle-isolation: ok');
}

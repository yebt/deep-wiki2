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
 *   3. No `apps/web` file may import `@deep-wiki/markdown`'s barrel at
 *      all — only its `"./pipeline"` subpath. The barrel reaches
 *      `render()`, and through it the syntax highlighter's grammars and
 *      `node:crypto`; read mode serves the HTML `render()` produced at
 *      save time and must not also ship the machine that produced it.
 *
 * Walks imports with `Bun.Transpiler().scanImports()`, exactly as
 * `core-purity.ts` does — no bundler, no `node_modules` resolution. It
 * follows two kinds of edge: relative specifiers, and `@deep-wiki/*`
 * workspace specifiers resolved through the target package's own
 * `package.json` `exports` map. Stopping at the workspace boundary was a
 * real hole: `packages/editor` importing `@deep-wiki/markdown` (the
 * barrel) instead of `@deep-wiki/markdown/pipeline` reaches `node:crypto`
 * through `block-index.ts`/`match-blocks.ts`, and a boundary-stopping walk
 * calls that clean. Anything else non-relative is either flagged
 * (forbidden) or left alone (a real `node_modules` dependency; assumed
 * fine — `single-parser.ts` and this repository's own dependency graph
 * cover what it can legitimately pull in beyond that).
 *
 * A relative specifier that resolves to NO file is a reported error, not a
 * skipped edge: a truncated closure proves nothing, and hiding a forbidden
 * import behind an edge the walker cannot follow is exactly the failure
 * this layer exists to prevent.
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

/**
 * Every extension a relative specifier in this repository can legitimately
 * resolve to. Narrower than this and the closure DROPS the edge — and a
 * dropped edge is a hole, not a pass: `./thing` next to a `thing.vue` or a
 * `thing.mts` used to end the walk silently, which is exactly where a
 * forbidden import would hide.
 */
const RELATIVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.vue', '.js', '.jsx', '.mjs', '.cjs'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);
/** Workspace globs from the root package.json — the only places a `@deep-wiki/*` package can live. */
const WORKSPACE_DIRS = ['packages', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', '.git', 'drizzle', '__fixtures__']);

/**
 * milkdown/@milkdown, @tiptap, or any prosemirror-* other than
 * prosemirror-model (design D21) — plus `node:crypto`/`crypto`, which has
 * no browser build and reached this closure once already via
 * `@deep-wiki/markdown`'s single barrel file before that package split
 * out a crypto-free `"./pipeline"` export (packages/markdown/src/pipeline.ts).
 * Same property, same enforcement point: "." is a browser-safe surface,
 * not just a ProseMirror-editing-safe one.
 */
function isForbiddenEditingSurface(specifier: string): boolean {
  if (specifier === 'milkdown' || specifier.startsWith('@milkdown/')) return true;
  if (specifier.startsWith('@tiptap/')) return true;
  if (specifier.startsWith('prosemirror-') && specifier !== 'prosemirror-model') return true;
  if (specifier === 'node:crypto' || specifier === 'crypto') return true;
  return false;
}

function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  const base = join(dirname(fromFile), specifier);
  const candidates = [base, ...RELATIVE_EXTENSIONS.map((ext) => `${base}${ext}`), ...RELATIVE_EXTENSIONS.map((ext) => join(base, `index${ext}`))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

/**
 * Maps every workspace package NAME to its directory, by reading the
 * `name` out of each `packages/*` and `apps/*` package.json. Built once
 * per run so the closure can keep walking across a `@deep-wiki/*` edge
 * instead of stopping at the package boundary.
 */
function workspacePackageDirs(root: string): Map<string, string> {
  const byName = new Map<string, string>();
  for (const group of WORKSPACE_DIRS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir) || !statSync(groupDir).isDirectory()) continue;
    for (const entry of readdirSync(groupDir)) {
      const manifest = join(groupDir, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      try {
        const name: unknown = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
        if (typeof name === 'string') byName.set(name, join(groupDir, entry));
      } catch {
        // A malformed manifest is workspace-shape.ts's problem, not this check's.
      }
    }
  }
  return byName;
}

type ExportsField = string | { [key: string]: ExportsField } | undefined;

/** Follows a package.json `exports` value (string, or conditions object) down to its first string target. */
function firstExportTarget(value: ExportsField): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['import', 'module', 'browser', 'default', 'require']) {
    const resolved = firstExportTarget(value[key]);
    if (resolved) return resolved;
  }
  return undefined;
}

/**
 * Resolves `@deep-wiki/markdown` / `@deep-wiki/markdown/pipeline` to the
 * file its package.json `exports` map points at. Returns `undefined` for a
 * specifier that names no workspace package (a real node_modules
 * dependency — left alone, exactly as before).
 */
function resolveWorkspaceImport(specifier: string, packages: Map<string, string>): string | undefined {
  const segments = specifier.split('/');
  for (const candidateLength of [2, 1]) {
    const name = segments.slice(0, candidateLength).join('/');
    const dir = packages.get(name);
    if (!dir) continue;
    const rest = segments.slice(candidateLength).join('/');
    const subpath = rest ? `./${rest}` : '.';
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { exports?: ExportsField };
    const exportsField = manifest.exports;
    const entry = typeof exportsField === 'string' ? (subpath === '.' ? exportsField : undefined) : firstExportTarget(exportsField?.[subpath]);
    if (!entry) return undefined;
    const file = join(dir, entry);
    return existsSync(file) && statSync(file).isFile() ? file : undefined;
  }
  return undefined;
}

const VUE_SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

/** A `.vue` SFC is not valid TypeScript — scan the code inside its `<script>` blocks instead. */
function scannableCode(file: string): string {
  const code = readFileSync(file, 'utf8');
  if (extname(file) !== '.vue') return code;
  return [...code.matchAll(VUE_SCRIPT_BLOCK)].map((match) => match[1]).join('\n');
}

function scanImportsOf(file: string): string[] {
  const transpiler = new Bun.Transpiler({ loader: extname(file) === '.tsx' || extname(file) === '.jsx' ? 'tsx' : 'ts' });
  return transpiler.scanImports(scannableCode(file)).map((imp) => imp.path);
}

/** Walks the "." export's transitive closure over relative AND `@deep-wiki/*` workspace edges, flagging any forbidden specifier it reaches. */
function checkEditorClosure(root: string, errors: string[]): void {
  const entry = join(root, 'packages', 'editor', 'src', 'index.ts');
  if (!existsSync(entry)) return; // no packages/editor in this fixture/root

  const packages = workspacePackageDirs(root);
  const visited = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    for (const specifier of scanImportsOf(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelativeImport(file, specifier);
        if (resolved) {
          queue.push(resolved);
        } else {
          // Never drop the edge: an unresolvable relative specifier is a
          // truncated closure, and a truncated closure is precisely where
          // a forbidden import hides. Fail loudly instead.
          errors.push(
            `${relative(root, file)}: relative import "${specifier}" resolves to no file — the "." export's closure cannot be ` +
              'walked past it, so this check cannot prove read mode stays free of the Milkdown/ProseMirror editing surface',
          );
        }
        continue;
      }
      // Keep walking across a workspace-package boundary: importing a
      // package's barrel instead of its narrow subpath export is how
      // node:crypto reached this closure once already (see above).
      const workspaceEntry = resolveWorkspaceImport(specifier, packages);
      if (workspaceEntry) {
        queue.push(workspaceEntry);
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

/**
 * Every STATIC form that pulls the mount entry into a chunk eagerly:
 * `import … from`, `export … from` (a re-export is just as eager as an
 * import), and a bare side-effect `import '…'` with no binding at all.
 * Only a dynamic `import(...)` — the parenthesis this pattern refuses to
 * match — is allowed.
 */
const EAGER_MOUNT_IMPORT_PATTERN =
  /(?:\b(?:import|export)\s+(?:type\s+)?[^;()]*\bfrom\s*|\bimport\s*)['"]@deep-wiki\/editor\/mount['"]/;

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

/**
 * The markdown BARREL, in any static or dynamic form, and never the
 * crypto-free `"./pipeline"` subpath beside it — the `/` is what the
 * negative lookahead refuses.
 */
const MARKDOWN_BARREL_IMPORT_PATTERN =
  /(?:\b(?:import|export)\s+(?:type\s+)?[^;()]*\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]@deep-wiki\/markdown['"`]/;

/**
 * No `apps/web` file may reach `@deep-wiki/markdown`'s barrel — only its
 * `"./pipeline"` subpath, which `packages/editor` already uses.
 *
 * Same property as the two rules above, at the other end of the same
 * boundary: the `"."` barrel reaches `render()`, and since 2026-09-23
 * `render()` reaches the syntax highlighter — thirty TextMate grammar
 * modules and a regex engine, ~20 MB resident, all of it decided at save
 * time and baked into `page_content.rendered_html`. Read mode serves that
 * cached HTML and must not also ship the machine that produced it
 * (docs/SPECS.md §5.3). The barrel reaches `node:crypto` too, which has no
 * browser build at all.
 *
 * `apps/web` does not declare `@deep-wiki/markdown` as a dependency, but
 * Bun hoists every workspace package into one `node_modules`, so the
 * specifier resolves from there whether or not the manifest asks for it —
 * which is precisely the kind of accident a structural check exists to
 * catch rather than trust. A *dynamic* import is no exemption here, unlike
 * the editor's mount: `"./pipeline"` is the subpath a browser-side
 * consumer wants, and it has been there since the split that created it.
 *
 * **Reversal condition**: `render()` becoming something read mode
 * legitimately runs in the browser, which would contradict §5.3's whole
 * reason for a cache.
 */
function checkNoMarkdownBarrelInWeb(root: string, errors: string[]): void {
  const webDir = join(root, 'apps', 'web');
  for (const file of findSourceFiles(webDir)) {
    if (!MARKDOWN_BARREL_IMPORT_PATTERN.test(readFileSync(file, 'utf8'))) continue;
    errors.push(
      `${relative(root, file)}: imports "@deep-wiki/markdown" (the barrel) — it reaches render(), and with it the ` +
        `syntax highlighter's grammars and node:crypto. Read mode serves cached HTML and must not ship the ` +
        `machine that produced it; import "@deep-wiki/markdown/pipeline" instead`,
    );
  }
}

export function checkBundleIsolation(root: string): BundleIsolationResult {
  const errors: string[] = [];

  checkEditorClosure(root, errors);
  checkNoEagerMountImport(root, errors);
  checkNoMarkdownBarrelInWeb(root, errors);

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

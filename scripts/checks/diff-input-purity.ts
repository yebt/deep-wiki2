/**
 * Structural check: nothing that calls `diffBlocks()` may feed it the
 * stored `block_index`/`blockIndex` anchors (versioning-and-collaboration
 * block-diff spec: "The Diff Re-Parses Both Sides Fresh").
 * `page_revision.block_index` is an anchor-only subset — a fully unanchored
 * document would silently diff to nothing if a caller read it instead of
 * re-parsing `content` fresh through `sliceBlocks()`/`matchBlocks()`, which
 * is exactly what `diffBlocks()` (`packages/markdown/src/diff-blocks.ts`)
 * does internally.
 *
 * A rule with no mechanism is advice (single-parser.ts's own precedent).
 *
 * Two rules, because one file is not the unit the defect lives in:
 *
 *   1. **Per file.** A file that calls `diffBlocks()` (or is its
 *      implementation) may not reference `block_index`/`blockIndex` in
 *      code. Calls through an import alias count: `import { diffBlocks as
 *      diff }` then `diff(...)` is the same call wearing a different name,
 *      and a rule written against one spelling is defeated by renaming.
 *   2. **Across files.** A per-file rule is defeated by splitting: put the
 *      `block_index` read in `anchors.ts`, call
 *      `diffBlocks(loadAnchors(a), …)` from `diff.ts`, and neither file
 *      trips rule 1 while together they are exactly the forbidden flow. So
 *      each caller's transitive closure over **relative value imports** is
 *      walked, and a module in it that reads `block_index` is reported
 *      against the caller that pulls it in.
 *
 * **What the cross-file walk can and cannot see.** Like `core-purity.ts`
 * and `bundle-isolation.ts`, it uses `Bun.Transpiler().scanImports()` and
 * follows relative specifiers only — no bundler, no `node_modules`
 * resolution, no workspace-alias resolution. So:
 *
 *   - Type-only imports are already elided by the transpiler, so a
 *     `import type { … }` edge is correctly not a data-flow edge.
 *   - A package boundary stops the walk. `@deep-wiki/db` legitimately
 *     reads `block_index` (it is the column's owner); following aliases
 *     into it would flag every diff caller and the check would be turned
 *     off within a week. The bounded walk is the enforceable rule.
 *   - `.vue` single-file components are checked per file but are not
 *     walked, and are not followed into: the transpiler has no SFC loader
 *     here.
 *   - Dynamic `import()` of a computed specifier, and a value re-exported
 *     through a non-relative barrel, are invisible.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

export interface DiffInputPurityResult {
  ok: boolean;
  errors: string[];
}

const BLOCK_INDEX_PATTERN = /\bblock_index\b|\bblockIndex\b/;
const DIFF_BLOCKS_CALL_PATTERN = /\bdiffBlocks\s*\(/;

/**
 * Strips `//` and `/* *\/` comments before matching. Explaining *why* the
 * diff never reads `block_index` necessarily names the column in prose —
 * exactly the "a check describing a forbidden pattern contains it" shape
 * `single-parser.ts` already exempts by file path; this check exempts it
 * by comment stripping instead, since the concern here is a real code
 * reference (a property access or column name), not a doc comment.
 */
function stripComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * `diff-blocks.ts` itself is always checked regardless of whether it
 * "calls" `diffBlocks` (it defines it) — the rule this check enforces
 * applies to the diff implementation's own source, not only its callers.
 */
function isDiffImplementation(relPath: string): boolean {
  return relPath.endsWith('packages/markdown/src/diff-blocks.ts');
}

/** `import { diffBlocks as diff } from '…'` — a named import block, with the specifier list captured. */
const NAMED_IMPORT_BLOCK = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;

/**
 * Local names `diffBlocks` was imported under. A type-only import — whole
 * (`import type { … }`) or per-specifier (`{ type diffBlocks as diff }`) —
 * erases at compile time, so it can never be a call site.
 */
export function diffBlocksAliases(code: string): string[] {
  const aliases: string[] = [];
  for (const block of code.matchAll(NAMED_IMPORT_BLOCK)) {
    if (block[1]) continue; // `import type { … }`
    for (const specifier of (block[2] ?? '').split(',')) {
      const named = /^\s*(type\s+)?diffBlocks\s+as\s+([A-Za-z0-9_$]+)\s*$/.exec(specifier);
      if (named && !named[1] && named[2]) aliases.push(named[2]);
    }
  }
  return aliases;
}

/** True when the code calls `diffBlocks()` under its own name or under an import alias. */
export function callsDiffBlocks(code: string): boolean {
  if (DIFF_BLOCKS_CALL_PATTERN.test(code)) return true;
  return diffBlocksAliases(code).some((alias) =>
    new RegExp(`(?<![A-Za-z0-9_$.])${alias}\\s*\\(`).test(code),
  );
}

export function checkFile(relPath: string, contents: string): string[] {
  const code = stripComments(contents);
  if (!isDiffImplementation(relPath) && !callsDiffBlocks(code)) return [];

  if (BLOCK_INDEX_PATTERN.test(code)) {
    return [
      `${relPath} calls diffBlocks() (or is its implementation) and also references block_index/blockIndex. ` +
        'The diff MUST re-parse content fresh via sliceBlocks()/matchBlocks(), never read the stored, ' +
        'anchor-only block_index column as input.',
    ];
  }
  return [];
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
const WALKABLE_EXTENSIONS = new Set(['.ts', '.tsx']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', '.git', 'drizzle', '__fixtures__']);

export function collectSourceFiles(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) acc.push(full);
  }
  return acc;
}

/** `diff-blocks.test.ts` and this check's own test are exempt: describing the forbidden pattern necessarily names it. */
function isSelfReferential(relPath: string): boolean {
  return /(^|\/)diff-input-purity(\.test)?\.ts$/.test(relPath) || relPath.endsWith('diff-blocks.test.ts');
}

function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  const base = join(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function scanRelativeImports(file: string): string[] {
  if (!WALKABLE_EXTENSIONS.has(extname(file))) return [];
  const transpiler = new Bun.Transpiler({ loader: extname(file) === '.tsx' ? 'tsx' : 'ts' });
  return transpiler
    .scanImports(readFileSync(file, 'utf8'))
    .map((imported) => imported.path)
    .filter((specifier) => specifier.startsWith('.'));
}

/**
 * Rule 2. Walks the transitive closure of relative value imports from a
 * `diffBlocks()` caller and reports every module in it that reads the
 * stored anchors — the flow rule 1 misses once it is split across two
 * files.
 */
export function checkImportClosure(root: string, entry: string): string[] {
  const entryRel = relative(root, entry);
  const entryCode = stripComments(readFileSync(entry, 'utf8'));
  if (!isDiffImplementation(entryRel) && !callsDiffBlocks(entryCode)) return [];

  const errors: string[] = [];
  const visited = new Set<string>([entry]);
  const queue = [...scanRelativeImports(entry)].flatMap((specifier) => {
    const resolved = resolveRelativeImport(entry, specifier);
    return resolved ? [resolved] : [];
  });

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const rel = relative(root, file);
    if (isSelfReferential(rel)) continue;

    if (BLOCK_INDEX_PATTERN.test(stripComments(readFileSync(file, 'utf8')))) {
      errors.push(
        `${entryRel} calls diffBlocks() and its imports reach ${rel}, which reads block_index/blockIndex. ` +
          'Splitting the read into another module does not make it a different data flow: the diff MUST ' +
          're-parse content fresh via sliceBlocks()/matchBlocks(), never take the stored, anchor-only ' +
          'block_index as input — directly or through a helper.',
      );
    }

    for (const specifier of scanRelativeImports(file)) {
      const resolved = resolveRelativeImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }

  return errors;
}

export function checkDiffInputPurity(root: string, roots: readonly string[]): DiffInputPurityResult {
  const errors: string[] = [];
  for (const dir of roots) {
    let files: string[];
    try {
      files = collectSourceFiles(join(root, dir));
    } catch {
      continue; // a workspace member that does not exist yet
    }
    for (const file of files) {
      const rel = relative(root, file);
      if (isSelfReferential(rel)) continue;
      errors.push(...checkFile(rel, readFileSync(file, 'utf8')));
      errors.push(...checkImportClosure(root, file));
    }
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const result = checkDiffInputPurity(root, ['apps', 'packages']);

  if (!result.ok) {
    for (const err of result.errors) console.error(`diff-input-purity: ${err}`);
    process.exit(1);
  }
  console.log('diff-input-purity: ok');
}

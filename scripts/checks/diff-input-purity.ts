/**
 * Structural check: no file that calls `diffBlocks()` may also reference
 * `block_index`/`blockIndex` (versioning-and-collaboration block-diff
 * spec: "The Diff Re-Parses Both Sides Fresh"). `page_revision.block_index`
 * is an anchor-only subset — a fully unanchored document would silently
 * diff to nothing if a caller read it instead of re-parsing `content`
 * fresh through `sliceBlocks()`/`matchBlocks()`, which is exactly what
 * `diffBlocks()` (`packages/markdown/src/diff-blocks.ts`) does internally.
 *
 * A rule with no mechanism is advice (single-parser.ts's own precedent).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

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

export function checkFile(relPath: string, contents: string): string[] {
  const code = stripComments(contents);
  const isCaller = DIFF_BLOCKS_CALL_PATTERN.test(code);
  if (!isDiffImplementation(relPath) && !isCaller) return [];

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

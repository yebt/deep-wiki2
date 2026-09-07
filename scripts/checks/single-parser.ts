/**
 * Structural check: `packages/markdown` is the only markdown parser.
 *
 * `CLAUDE.md` calls this non-negotiable, and until now it lived only in
 * prose. `@nuxt/ui` v4 ships a TipTap-based editor surface (`UEditor`,
 * `useEditorMenu`, its `utils/editor`) that carries its own markdown
 * serialiser, and it is already in this repository's dependency tree. A
 * one-line component import would have introduced a second parser whose
 * output diverges from ours on exactly the edge cases GATE-2 exists to
 * pin down — and nothing would have failed.
 *
 * A rule with no mechanism is advice.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface SingleParserResult {
  ok: boolean;
  errors: string[];
}

/** Packages whose presence in a source file means a second markdown parser. */
const FORBIDDEN_SPECIFIERS: readonly string[] = [
  '@tiptap/',
  'prosemirror-markdown',
  'markdown-it',
  'marked',
  'showdown',
  'commonmark',
  'micromark', // only via packages/markdown's own pipeline
  'remark-parse',
  'remark-stringify',
  // Milkdown is the ProseMirror editor this project will build on. It is
  // legitimate inside packages/editor and nowhere else: it carries its own
  // markdown serialiser, so a stray import elsewhere is a second parser by
  // another name.
  '@milkdown/',
  'milkdown',
];

/** Component and composable names from @nuxt/ui's own editor surface. */
const FORBIDDEN_UI_EDITOR = /\bU(Editor|EditorToolbar|EditorBubbleMenu)\b|useEditorMenu/;

/** Only these may reach for the pipeline's own building blocks. */
const PARSER_OWNERS = ['packages/markdown/', 'packages/editor/'];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);
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

export function checkFile(relPath: string, contents: string): string[] {
  const errors: string[] = [];
  const owned = PARSER_OWNERS.some((owner) => relPath.startsWith(owner));

  if (!owned) {
    for (const specifier of FORBIDDEN_SPECIFIERS) {
      if (contents.includes(`'${specifier}`) || contents.includes(`"${specifier}`)) {
        errors.push(
          `${relPath} reaches for \`${specifier}\`. packages/markdown is the single markdown ` +
            `pipeline (CLAUDE.md); a second parser diverges on the edge cases GATE-2 pins down.`,
        );
      }
    }
  }

  if (FORBIDDEN_UI_EDITOR.test(contents)) {
    errors.push(
      `${relPath} uses @nuxt/ui's TipTap editor surface. It carries its own markdown ` +
        `serialiser, which would silently become a second parser. Build on packages/editor instead.`,
    );
  }

  return errors;
}

/**
 * A check that describes forbidden patterns necessarily contains them. Its
 * own source and tests are excluded, following the precedent set by
 * `query-boundaries.ts`, which flagged itself for the same reason.
 * `bundle-isolation.ts` (and its test, and its fixtures' violating cases)
 * shares this exemption: it also compares against and asserts on
 * `milkdown`/`@milkdown/`/`@tiptap/` string literals to describe the exact
 * specifiers its own denylist forbids.
 */
export function isSelfReferential(relPath: string): boolean {
  return /(^|\/)(single-parser|bundle-isolation)(\.test)?\.ts$/.test(relPath);
}

export function checkSingleParser(root: string, roots: readonly string[]): SingleParserResult {
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
  const result = checkSingleParser(root, ['apps', 'packages', 'scripts']);

  if (!result.ok) {
    for (const err of result.errors) console.error(`single-parser: ${err}`);
    process.exit(1);
  }
  console.log('single-parser: ok');
}

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
 *
 * ── Four evasions this check used to pass, closed here ─────────────────
 *
 *  1. `import { remark } from 'remark'`. The denylist named `remark-parse`
 *     and `remark-stringify` but not the meta-package that *is* both of
 *     them: `remark` is literally `unified().use(remarkParse)
 *     .use(remarkStringify)`. One import, a complete second pipeline.
 *
 *  2. `mdast-util-from-markdown` + `mdast-util-to-markdown`. Both are
 *     installed here (the second directly, the first transitively and
 *     therefore hoisted and importable), and together they are a full
 *     markdown round trip carrying none of the shared pipeline's GFM,
 *     frontmatter, wiki-link, tag or block-anchor extensions. They stay
 *     legal inside `PARSER_OWNERS`, because `packages/markdown`'s own
 *     serialiser extensions are built on `mdast-util-to-markdown`'s
 *     `defaultHandlers` — those ARE the shared pipeline, not a second one.
 *
 *  3. `` import(`@milkdown/core`) ``. The denylist compared each specifier
 *     against `'x` and `"x`, so the third quote character JavaScript has
 *     walked past it. Specifiers are extracted now, not string-matched.
 *
 *  4. `prosemirror-markdown` was BLESSED inside `packages/editor` by this
 *     check's own test, with no justification written down anywhere — in
 *     the one package whose entire job is markdown<->ProseMirror
 *     conversion, for a package that ships `defaultMarkdownParser` and
 *     `defaultMarkdownSerializer`: a complete second markdown parser.
 *     See `FORBIDDEN_EVERYWHERE`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface SingleParserResult {
  ok: boolean;
  errors: string[];
}

/**
 * Packages whose presence in a NON-OWNER source file means a second markdown
 * parser. An entry ending in `/` is a scope/prefix match; every other entry
 * matches the specifier exactly, or as the root of a subpath import
 * (`markdown-it/lib/token`).
 */
const FORBIDDEN_SPECIFIERS: readonly string[] = [
  '@tiptap/',
  'markdown-it',
  'marked',
  'showdown',
  'commonmark',
  'micromark', // only via packages/markdown's own pipeline
  'remark-parse',
  'remark-stringify',
  // The meta-package IS `unified().use(remarkParse).use(remarkStringify)`.
  // Naming only its two halves let one import reconstitute the whole thing.
  'remark',
  // A complete round trip on their own, with none of this repository's GFM,
  // frontmatter, wiki-link, tag or block-anchor extensions. Legal inside
  // PARSER_OWNERS: packages/markdown's serialiser extensions are built on
  // mdast-util-to-markdown's `defaultHandlers` and are the shared pipeline.
  'mdast-util-from-markdown',
  'mdast-util-to-markdown',
  // Milkdown is the ProseMirror editor this project will build on. It is
  // legitimate inside packages/editor and nowhere else: it carries its own
  // markdown serialiser, so a stray import elsewhere is a second parser by
  // another name.
  '@milkdown/',
  'milkdown',
];

/**
 * Forbidden **everywhere**, `PARSER_OWNERS` included.
 *
 * `prosemirror-markdown` ships `defaultMarkdownParser` and
 * `defaultMarkdownSerializer`: a complete markdown parser and serialiser,
 * built on markdown-it, with its own commonmark-flavoured opinions about
 * every edge case GATE-2 pins down. Inside `packages/editor` — the one
 * package whose entire job is markdown<->ProseMirror conversion — it is not
 * a helper, it is the competing implementation of that package's whole
 * reason to exist, and the divergence would be invisible until a round trip
 * silently rewrote a user's file.
 *
 * It was previously blessed there by this check's own test, with no
 * justification recorded anywhere. Compare `bundle-isolation.ts`'s
 * `prosemirror-model` exemption, which carries its reasoning and a stated
 * reversal condition; this one carried nothing, and nothing was paying for
 * it either: `packages/editor/package.json` does not depend on
 * `prosemirror-markdown`, and `src/to-markdown.ts` converts through
 * `packages/markdown`'s mdast instead.
 *
 * **Reversal condition**: only if `packages/markdown` is retired as the
 * single pipeline, which CLAUDE.md lists as non-negotiable.
 */
const FORBIDDEN_EVERYWHERE: readonly string[] = ['prosemirror-markdown'];

/** Component and composable names from @nuxt/ui's own editor surface. */
const FORBIDDEN_UI_EDITOR = /\bU(Editor|EditorToolbar|EditorBubbleMenu)\b|useEditorMenu/;

/** Only these may reach for the pipeline's own building blocks. */
const PARSER_OWNERS = ['packages/markdown/', 'packages/editor/'];

/**
 * The single file allowed to construct the shared `unified().use(remarkParse)`
 * / `.use(remarkStringify)` processor. Every other file — including
 * elsewhere inside `packages/markdown` and `packages/editor`, both
 * `PARSER_OWNERS` above — must import `parse()`/`stringify()` from it
 * instead of building a second processor of its own.
 *
 * `PARSER_OWNERS` above governs *who may import the raw remark/unified
 * building blocks at all*; it does not, by itself, stop a second, divergent
 * processor from being built with them once inside an owner directory. That
 * is exactly the gap `render.ts` fell through: it lived inside
 * `packages/markdown/`, an allowed owner, and instantiated its own bare
 * `unified().use(remarkParse)` with none of the shared pipeline's GFM,
 * frontmatter, or wiki-link/tag/block-anchor extensions — undetected,
 * because this check only ever asked *which package* imported the parser,
 * never *how many pipeline instances* existed inside it.
 */
const SOLE_PIPELINE_OWNER = 'packages/markdown/src/pipeline.ts';

/** The specifiers that mean "this file constructs its own markdown processor". */
const PIPELINE_CONSTRUCTION_SPECIFIERS: readonly string[] = ['remark-parse', 'remark-stringify'];

/**
 * Whether `relPath` may construct its own `remark-parse`/`remark-stringify`
 * processor. `.test.ts` files are exempt: several already legitimately
 * build a throwaway, deliberately "naive" comparison pipeline to prove what
 * a missing pin or an unmodelled schema node would produce
 * (`round-trip.test.ts`, `canonical.test.ts`) — the same "a check that
 * describes a forbidden pattern necessarily contains it" exemption
 * `isSelfReferential` below already grants this file's own test.
 */
function mayConstructPipeline(relPath: string): boolean {
  return relPath === SOLE_PIPELINE_OWNER || relPath.endsWith('.test.ts');
}

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

/**
 * Every module specifier the file names: `from '…'`, `import '…'`,
 * `import('…')` and `require('…')`, in **all three** quote characters.
 * Matching the specifier itself rather than searching the raw text for
 * `'markdown-it` is what closes the backtick hole — and it stops a package
 * name mentioned in a doc comment from counting as an import, which is how
 * the reasoning in this file gets written down at all.
 */
const SPECIFIER_PATTERN = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`]([^'"`\n]+)['"`]/g;

export function specifiersIn(contents: string): string[] {
  const found: string[] = [];
  for (const match of contents.matchAll(SPECIFIER_PATTERN)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

/**
 * An entry ending in `/` is a scope/prefix match (`@milkdown/`); every other
 * entry matches exactly, or as the root of a subpath import
 * (`markdown-it/lib/token`). Prefix-matching a bare name would make
 * `remark` swallow `remark-gfm`, which packages/markdown legitimately uses.
 */
function matchesDenylistEntry(specifier: string, entry: string): boolean {
  if (entry.endsWith('/')) return specifier.startsWith(entry);
  return specifier === entry || specifier.startsWith(`${entry}/`);
}

export function checkFile(relPath: string, contents: string): string[] {
  const errors: string[] = [];
  const owned = PARSER_OWNERS.some((owner) => relPath.startsWith(owner));
  const specifiers = specifiersIn(contents);

  for (const entry of FORBIDDEN_EVERYWHERE) {
    if (specifiers.some((specifier) => matchesDenylistEntry(specifier, entry))) {
      errors.push(
        `${relPath} reaches for \`${entry}\`, which ships a complete second markdown parser and ` +
          `serialiser (defaultMarkdownParser/defaultMarkdownSerializer). packages/markdown is the ` +
          `single pipeline (CLAUDE.md), and this rule has no owner exemption — see FORBIDDEN_EVERYWHERE.`,
      );
    }
  }

  if (!owned) {
    for (const entry of FORBIDDEN_SPECIFIERS) {
      if (specifiers.some((specifier) => matchesDenylistEntry(specifier, entry))) {
        const specifier = entry;
        errors.push(
          `${relPath} reaches for \`${specifier}\`. packages/markdown is the single markdown ` +
            `pipeline (CLAUDE.md); a second parser diverges on the edge cases GATE-2 pins down.`,
        );
      }
    }
  } else if (!mayConstructPipeline(relPath)) {
    // Owned by packages/markdown or packages/editor, but not the sole
    // pipeline owner nor a test: reaching for remark-parse/remark-stringify
    // here builds a second, divergent processor inside an already-allowed
    // package — the exact bug class the block above cannot see.
    for (const specifier of PIPELINE_CONSTRUCTION_SPECIFIERS) {
      if (specifiers.some((found) => matchesDenylistEntry(found, specifier))) {
        errors.push(
          `${relPath} imports \`${specifier}\` directly, constructing its own markdown processor. Only ` +
            `${SOLE_PIPELINE_OWNER} may build the shared parse/stringify pipeline — every other file, including ` +
            `inside packages/markdown and packages/editor, must import parse()/stringify() from it instead. A ` +
            `second processor instance is a second parser even inside an allowed package.`,
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

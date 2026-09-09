/**
 * The core parse/stringify/canonicalise pipeline, split into its own file
 * and its own package export (`"./pipeline"`) so a browser-side consumer
 * can reach it without transitively loading `block-index.ts`/
 * `match-blocks.ts`, both of which import `node:crypto`'s `createHash`
 * for block-id hashing (design.md — "a block's id is `d:` +
 * `sha256(...)`"). `node:crypto` has no browser build; a bundler that
 * tree-shakes per export (a real `nuxt build`, verified 2026-09-06 —
 * the production chunk contains no `createHash`/`crypto` reference)
 * survives importing it through the single barrel `index.ts` used to be,
 * but Vite's DEV server serves each ES module file as-is with no
 * tree-shaking at all, so evaluating ANY export from that one shared file
 * evaluates ALL of its top-level imports — including the ones the
 * `"./pipeline"` consumer never asked for. This is the exact class of
 * problem `packages/editor`'s `"."`/`"./mount"` split already solves for
 * a different dependency (ProseMirror-view); this file is that same
 * technique applied to `node:crypto`.
 *
 * `packages/editor/src/{from-markdown,to-markdown}.ts` — the two
 * functions apps/web's edit route calls directly in the browser — import
 * from here, never from the main `"."` barrel. `packages/db` and
 * `apps/api` keep importing the full barrel unchanged: they run
 * server-side only, where `node:crypto` is never a problem.
 */
import type { Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import {
  applyBlockAnchors,
  blockAnchorToMarkdown,
  markCaretsForEscaping,
  protectEscapedCarets,
  restoreEscapedCarets,
} from './extensions/block-anchor';
import { applyBreakSpellings, breakToMarkdown } from './extensions/hard-break';
import { applyListMarkers, listToMarkdown } from './extensions/list-marker';
import { applyTags, tagToMarkdown } from './extensions/tag';
import { verbatimInlineToMarkdown, verbatimToMarkdown } from './extensions/verbatim';
import { applyWikiLinks, wikiLinkToMarkdown, type WikiLinkResolver } from './extensions/wiki-link';

/**
 * Every `remark-stringify` option that decides a *spelling* rather than a
 * *meaning* (design.md "The pinned-options rule, made mechanical"; docs/TODO.md
 * 2026-09-04 finding). Two kinds of entry live here, and both matter:
 *
 * - **Efficacious** pins — `bullet`, `emphasis`, `resourceLink`, `strong`,
 *   `tightDefinitions` (5 keys): the pinned value differs from remark's own
 *   default, so deleting the key changes the serialised bytes of a fixture.
 * - **Defensive** pins — `bulletOrdered`, `fence`, `fences`, `listItemIndent`,
 *   `rule`, `setext` (6 keys): the pinned value already restates remark's
 *   default, chosen deliberately over an efficacious-but-unconventional
 *   alternative (e.g. `)`-style ordered lists, tab-padded bullets) to keep this
 *   product's canonical Markdown unsurprising to the humans who read it.
 *   Deleting one of these is a byte no-op today, so an output diff alone could
 *   never catch its loss; they are pinned — and their presence asserted — so a
 *   future remark upgrade that moves its own default cannot silently change
 *   this pipeline's canonical spelling out from under a fixture.
 *
 * Nothing here is documentation-only. `canonical.test.ts` runs three named
 * assertions against **every** key in this object, efficacious and defensive
 * alike, each backed by `fixtures/pins/pin-<key>.md`:
 *
 * 1. the key is present with exactly the value frozen here, and the pinned
 *    options reproduce that fixture's bytes — deleting any key fails this;
 * 2. the fixture serialises differently under another legal value for the
 *    option — proof the fixture exercises the option instead of decorating it;
 * 3. dropping the key changes the bytes, or provably does not — the
 *    `differsWhenRemoved` flag in that file's `PIN_CASES` is the machine-checked
 *    record of which group above each key belongs to, asserted in both
 *    directions, so a remark release that moves a default fails a named test
 *    rather than drifting.
 *
 * That test reads this object's own keys rather than a hardcoded list, so a
 * new pin without a case, or a case outliving its pin, fails there too.
 */
export const PINNED_OPTIONS = {
  bullet: '-',
  bulletOrdered: '.',
  emphasis: '_',
  fence: '`',
  fences: true,
  listItemIndent: 'one',
  resourceLink: true,
  rule: '*',
  setext: false,
  strong: '_',
  tightDefinitions: true,
} as const;

const parseProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);
const stringifyProcessor = unified().use(remarkStringify, {
  ...PINNED_OPTIONS,
  handlers: {
    blockAnchor: blockAnchorToMarkdown,
    break: breakToMarkdown,
    list: listToMarkdown,
    tag: tagToMarkdown,
    verbatim: verbatimToMarkdown,
    verbatimInline: verbatimInlineToMarkdown,
    wikiLink: wikiLinkToMarkdown,
  },
});
stringifyProcessor.use(remarkGfm).use(remarkFrontmatter, ['yaml']);

export interface ParseOptions {
  /** Resolves a wiki-link's target title to a page identity, if one exists. */
  resolveWikiLink?: WikiLinkResolver;
}

/**
 * Parses Markdown source into an mdast syntax tree, including this
 * pipeline's custom syntax: GFM (tables, footnotes, strikethrough, task
 * lists), wiki-links, `#tag`s, and persisted block-ID anchors.
 */
export function parse(markdown: string, options: ParseOptions = {}): Root {
  const protectedMarkdown = protectEscapedCarets(markdown);
  const tree = parseProcessor.parse(protectedMarkdown) as Root;
  applyListMarkers(tree, protectedMarkdown);
  applyBreakSpellings(tree, protectedMarkdown);
  applyBlockAnchors(tree);
  applyWikiLinks(tree, options.resolveWikiLink);
  applyTags(tree);
  return tree;
}

/** Serializes an mdast syntax tree back into Markdown source. */
export function stringify(tree: Root): string {
  // Operate on a clone: callers should not see their tree mutated by the
  // pre-stringify anchor bookkeeping below.
  const clone = structuredClone(tree);
  markCaretsForEscaping(clone);
  return restoreEscapedCarets(stringifyProcessor.stringify(clone));
}

/**
 * The canonical form of a Markdown document under this pipeline's pinned
 * spelling (design.md "The canonical-form invariant", D1). Idempotent by
 * construction: `canonicalise(canonicalise(x)) === canonicalise(x)` for any
 * input, which is what `savePage()` will later assert to reject a
 * non-canonical write.
 */
export function canonicalise(markdown: string): string {
  return stringify(parse(markdown));
}

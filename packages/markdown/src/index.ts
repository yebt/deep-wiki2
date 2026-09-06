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

export { collectWikiLinks } from './extensions/wiki-link';
export type { CollectedWikiLink, WikiLinkNode, WikiLinkResolver, WikiLinkTarget } from './extensions/wiki-link';
export { collectTags } from './extensions/tag';
export type { TagNode } from './extensions/tag';
export type { BlockAnchorNode } from './extensions/block-anchor';
export type { VerbatimInlineNode, VerbatimNode } from './extensions/verbatim';
export { buildBlockIndex } from './block-index';
export type { BlockIndex, BlockIndexEntry } from './block-index';
export { sliceBlocks } from './blocks';
export type { BlockSlice } from './blocks';
export { chunk } from './chunk';
export type { Chunk, ChunkOptions } from './chunk';
export { deriveBlockId, matchBlocks, mintBlockId, MATCH_THRESHOLD } from './match-blocks';
export type { BlockAssignment, BlockAssignmentStatus, MatchBlocksResult, PersistedBlockRecord } from './match-blocks';
export { render } from './render';

/**
 * The single shared unified/remark pipeline (docs/SPECS.md §13, §14):
 * every consumer that needs to read or write Markdown — the editor, the
 * API, and later the indexer — goes through this package rather than
 * instantiating its own parser.
 */

/**
 * Every `remark-stringify` option that decides a *spelling* rather than a
 * *meaning* (design.md "The pinned-options rule, made mechanical"; docs/TODO.md
 * 2026-09-04 finding). Two kinds of entry live here, and both matter:
 *
 * - **Efficacious** pins (`bullet`, `emphasis`, `strong`, `resourceLink`,
 *   `tightDefinitions`): the pinned value differs from remark's own default,
 *   so removing the key changes the serialised bytes. `bullet`'s efficacy is
 *   asserted by an executable test (`canonical.test.ts`); the fixture per key
 *   documents the rest.
 * - **Defensive** pins (`bulletOrdered`, `fence`, `fences`, `listItemIndent`,
 *   `rule`, `setext`): the pinned value already matches remark's default,
 *   chosen deliberately over an efficacious-but-unconventional alternative
 *   (e.g. `)`-style ordered lists, tab-padded bullets) to keep this
 *   product's canonical Markdown unsurprising to the humans who read it.
 *   They are pinned anyway so a future remark upgrade that changes its
 *   default cannot silently change this pipeline's canonical spelling out
 *   from under a fixture.
 *
 * `fixtures/pins/pin-<key>.md` must exist for every key here — see the pin
 * coverage test, which reads these keys rather than a hardcoded list so it
 * cannot drift.
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

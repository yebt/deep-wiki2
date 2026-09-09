import { toHtml } from 'hast-util-to-html';
import type { Handler } from 'mdast-util-to-hast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { findBlockAnchor } from './extensions/block-anchor';
import type { TagNode } from './extensions/tag';
import type { WikiLinkNode } from './extensions/wiki-link';
import { parse } from './pipeline';

/**
 * The URL-scheme allowlist for `link`/`image` targets (`href`/`src`),
 * stated explicitly rather than left to the sanitiser's own defaults — "a
 * rule with no mechanism is advice" (scripts/checks/single-parser.ts
 * carries the same principle for the parser rule). `javascript:` and
 * `data:` are excluded outright: neither is a legitimate target for
 * content a workspace member writes.
 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
  attributes: {
    ...defaultSchema.attributes,
    // `wikiLinkHandler`/`tagHandler` below carry their class on a plain
    // `<span>`, which the default schema does not otherwise allow a
    // `className` on.
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
    // versioning-and-collaboration design.md Decision 6: `dataBlockId`
    // must survive sanitisation on any element, not just one tag — the
    // transform below applies it to whichever block-level element a
    // persisted anchor happens to land on.
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataBlockId'],
  },
  // `mdast-util-to-hast`'s footnote handlers already apply their own
  // `user-content-` clobber prefix (default) to build matching `id`/`href`
  // pairs (`footnote-reference.js`). `hast-util-sanitize`'s clobbering only
  // ever rewrites `id`/`name`/aria attributes, never `href` — leaving its
  // own default prefix enabled here would re-prefix just the `id` half of
  // each pair, breaking the `href="#..."` link to it. Disabling it here
  // keeps the single prefix `remark-rehype` already applied consistently.
  clobberPrefix: '',
};

/**
 * `mdast-util-to-hast` handler for `wikiLink` nodes: renders the link's own
 * text (alias, or target when there is none) inside a plain, unlinked
 * `<span>` — matching `packages/editor/src/schema.ts`'s `wikiLink.toDOM`
 * class, but never emitting an `<a>`. Read mode is not clickable yet
 * (docs/TODO.md's per-viewer/per-page-cache tension, SPECS §14, stays
 * unresolved this batch), and `render()` still has no channel to receive a
 * wiki-link's resolution status — `resolved` is never populated here, so a
 * resolved-looking and an unresolved-looking target keep rendering with
 * byte-identical treatment (knowledge-graph: Unresolved-Link Rendering
 * Does Not Disclose Existence).
 */
const wikiLinkHandler: Handler = (_state, node) => {
  const wikiLink = node as unknown as WikiLinkNode;
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['wiki-link'] },
    children: [{ type: 'text', value: wikiLink.alias || wikiLink.target }],
  };
};

/**
 * `mdast-util-to-hast` handler for `tag` nodes: renders as a `<span>`
 * carrying the literal `#name` text, matching `schema.ts`'s `tag.toDOM`.
 * Without this, the default unknown-node handler would wrap it in an empty
 * `<div>` (a `tag` node has no `value` and no children — the name lives in
 * its own `name` attribute), silently dropping the tag's text entirely.
 */
const tagHandler: Handler = (_state, node) => {
  const tag = node as unknown as TagNode;
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['tag'] },
    children: [{ type: 'text', value: `#${tag.name}` }],
  };
};

/**
 * `mdast-util-to-hast` handler for `blockAnchor` nodes: renders nothing.
 * A persisted ` ^id` anchor is internal bookkeeping (block identity, design.md
 * "Block identity") a reader was never meant to see; without this handler
 * the default unknown-node handler would wrap it in an empty `<div>` inside
 * inline content — invalid nesting — and still not carry the id anywhere
 * useful.
 */
const blockAnchorHandler: Handler = () => undefined;

/**
 * Bumped whenever the render pipeline's *output shape* changes in a way a
 * saved `page_content.pipeline_version` must be able to detect as stale
 * (versioning-and-collaboration design.md Decision 6, "Staleness
 * detection and backfill"). `savePage` writes this on every save;
 * `content_hash` alone cannot detect the case where the Markdown did not
 * change but the pipeline did. 1 was the column's own migration default
 * (`0008_page_content.sql:27`) and was never actually written by any
 * code path before this constant existed — 2 is therefore the first
 * value any save has ever truthfully written.
 */
export const CURRENT_PIPELINE_VERSION = 2;

const renderTransform = unified()
  .use(remarkRehype, {
    allowDangerousHtml: true,
    handlers: {
      wikiLink: wikiLinkHandler,
      tag: tagHandler,
      blockAnchor: blockAnchorHandler,
    },
  })
  .use(rehypeSanitize, SANITIZE_SCHEMA);

/**
 * Renders canonical Markdown to sanitised HTML for the read-mode cache.
 *
 * Parses through the shared pipeline (`./pipeline`'s `parse()`) rather than
 * a bare `remark-parse` instance, so GFM (tables, footnotes, strikethrough,
 * task lists), frontmatter, wiki-links, tags and block anchors are all
 * recognised here exactly as everywhere else in the system — this used to
 * be a second, unextended `unified()` pipeline (the exact bug class
 * `scripts/checks/single-parser.ts` and the markdown-pipeline spec exist to
 * forbid), so a table rendered as raw pipe text, a footnote reference lost
 * its link to its definition, and wiki-links/tags rendered as inert literal
 * brackets/hashes.
 *
 * Sanitising still happens here — at render time — never at save (design.md
 * D12, threat matrix: executable-file/active-content classification): the
 * stored Markdown keeps a raw `<script>` or `onerror` attribute byte for
 * byte, exactly as GATE-2 requires, and this function is what stands
 * between that stored content and a browser. `resolveWikiLink` is
 * deliberately never passed to `parse()` here — see `wikiLinkHandler`.
 *
 * `render()` parses its own local `tree` here, never one shared with
 * `savePage`/`reconcileDerived` — the `hProperties` mutation below is
 * therefore isolated by construction, and `data.hProperties` is ignored by
 * `remark-stringify`, so GATE-2 round-trip is unaffected either way
 * (versioning-and-collaboration design.md Decision 6).
 */
export function render(markdown: string): string {
  const tree = parse(markdown);

  // A transform over root children only (design.md Decision 6):
  // `mdast-util-to-hast` honours `node.data.hProperties`, so no positional
  // mdast->hast mapping is needed and no second pipeline is constructed.
  // `blockAnchorHandler` above still renders nothing for the anchor's own
  // inline node — it cannot set an attribute on its parent block, which is
  // exactly why this runs one level up instead.
  for (const child of tree.children) {
    const anchor = findBlockAnchor(child);
    if (!anchor) continue;
    // The hProperty key is the camelCase *property* name (`dataBlockId`),
    // not the kebab-case attribute (`data-block-id`) — `hast-util-sanitize`
    // resolves an unknown property strictly by this camelCase form via
    // `property-information`'s schema lookup, and a kebab-case key here
    // fails that lookup and is silently stripped, even with the attribute
    // allowed in `SANITIZE_SCHEMA`. `hast-util-to-html` renders it back out
    // as `data-block-id` regardless of which spelling produced it.
    //
    // `child.data` is typed too wide to read `.hProperties` directly:
    // `RootContent` includes `VerbatimNode`/`VerbatimInlineNode`
    // (extensions/verbatim.ts), which extend unist's own bare `Node` rather
    // than mdast's `Parent`/`Literal` — so their `data` field carries
    // unist's own `Data`, never augmented with `hProperties`, and a direct
    // property read across that union is a type error even though no real
    // block ever reaches this loop as one of those two node types.
    const existingData = child.data as { hProperties?: Record<string, unknown> } | undefined;
    child.data = { ...child.data, hProperties: { ...existingData?.hProperties, dataBlockId: anchor.id } };
  }

  const hast = renderTransform.runSync(tree);
  return toHtml(hast);
}

import { toHtml } from 'hast-util-to-html';
import type { Handler } from 'mdast-util-to-hast';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
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
 */
export function render(markdown: string): string {
  const tree = parse(markdown);
  const hast = renderTransform.runSync(tree);
  return toHtml(hast);
}

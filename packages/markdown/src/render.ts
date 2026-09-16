import type { Root as HastRoot } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type { Handler } from 'mdast-util-to-hast';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { sliceBlocks } from './blocks';
import { findBlockAnchor, isAnchorableBlock } from './extensions/block-anchor';
import type { TagNode } from './extensions/tag';
import type { WikiLinkNode } from './extensions/wiki-link';
import { parse } from './pipeline';

/**
 * The `id` values this schema is willing to emit: exactly the shapes
 * `mdast-util-to-hast`'s own footnote handlers mint — `user-content-fn-*`
 * and `user-content-fnref-*` under their default clobber prefix
 * (`footnote-reference.js`), plus the literal `footnote-label` the
 * footnote section's heading carries as the target of every reference's
 * `aria-describedby` (`footer.js`). Stated as an allowlist rather than as
 * a bare `'id'` allowance so that "an author cannot name an element" is a
 * property the sanitiser enforces, not one that merely happens to hold.
 *
 * `footnote-label` is listed explicitly because omitting it is silent: the
 * `id` disappears, the `aria-describedby` pointing at it stays, and every
 * footnote reference is left describing nothing. `render.test.ts` asserts
 * both halves of that pair.
 */
const MACHINE_MINTED_IDS = [/^user-content-fn(?:ref)?-/, 'footnote-label'] as const;

/**
 * `data-block-id` carries a persisted block anchor's id, whose grammar is
 * `[0-9A-Za-z]+` (`extensions/block-anchor.ts`'s `TRAILING_ANCHOR`).
 * Pinned to that grammar for the same reason as `MACHINE_MINTED_IDS`: the
 * attribute exists for `render()`'s own transform below, and raw HTML now
 * reaches the same rule.
 */
const BLOCK_ANCHOR_ID = /^[0-9A-Za-z]+$/;

/**
 * `data-derived-block-id` carries the *derived* identity of a top-level
 * block that has no persisted anchor yet — `deriveBlockId`'s
 * `d:<12 hex>#<occurrence>` (`match-blocks.ts`). It is the id a reader
 * hands `POST /pages/:id/comments` to start a thread on such a block:
 * the read screen composes its overlay over this cached HTML and never
 * parses, so an identity that lives only in `sliceBlocks` would be one
 * no reader could name (`apps/web/app/pages/pages/[id]/index.vue`).
 * Kept apart from `data-block-id` — which stays "a persisted anchor,
 * nothing else", exactly as the comment-overlay spec states it — so the
 * two attributes never have to be told apart by their value's shape.
 * Pinned to its grammar for the same reason `BLOCK_ANCHOR_ID` is.
 */
const DERIVED_BLOCK_ID = /^d:[0-9a-f]{12}#[0-9]+$/;

/**
 * Elements removed **with their children** rather than unwrapped. The
 * default schema strips only `script`; everything else it disallows keeps
 * its children, which is right for prose containers and wrong for these —
 * their child text is stylesheet source, graphics/notation markup, or
 * inert template content, never something a reader was meant to read as
 * words. Stripping them also removes the parser-differential surface the
 * classic `<math><mtext><table><mglyph><style>` mXSS sequence needs.
 */
const STRIPPED_TAGS = [
  ...(defaultSchema.strip ?? []),
  'embed',
  'iframe',
  'math',
  'noscript',
  'object',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
];

/**
 * The URL-scheme allowlist for `link`/`image` targets (`href`/`src`),
 * stated explicitly rather than left to the sanitiser's own defaults — "a
 * rule with no mechanism is advice" (scripts/checks/single-parser.ts
 * carries the same principle for the parser rule). `javascript:` and
 * `data:` are excluded outright: neither is a legitimate target for
 * content a workspace member writes.
 *
 * Every allowance below is now **author-reachable**: `rehype-raw` parses
 * the raw HTML a document carries verbatim (SPECS §5.1, bucket B) into
 * real elements, so this schema — not the accident of `raw` nodes being
 * dropped — is the only thing standing between stored Markdown and a
 * reader's DOM (`apps/web/app/pages/pages/[id]/index.vue` injects the
 * cached result with `v-html`). Three allowances that were previously
 * reachable only by this file's own handlers are therefore narrowed to
 * exactly what those handlers emit.
 */
const SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  strip: STRIPPED_TAGS,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
  attributes: {
    ...defaultSchema.attributes,
    // `wikiLinkHandler`/`tagHandler` below carry their class on a plain
    // `<span>`, which the default schema does not otherwise allow a
    // `className` on. Narrowed to those two literal class names: an open
    // `className` here would let raw HTML dress any span as a wiki-link
    // or a tag, or borrow an application class from the read screen.
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'wiki-link', 'tag']],
    // versioning-and-collaboration design.md Decision 6: `dataBlockId`
    // must survive sanitisation on any element, not just one tag — the
    // transform below applies it to whichever block-level element a
    // persisted anchor happens to land on.
    //
    // `id` and `name` are dropped from the default `'*'` list and `id` is
    // re-admitted only under `MACHINE_MINTED_IDS`: see `clobberPrefix`.
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []).filter((property) => property !== 'id' && property !== 'name'),
      ['id', ...MACHINE_MINTED_IDS],
      ['dataBlockId', BLOCK_ANCHOR_ID],
      ['dataDerivedBlockId', DERIVED_BLOCK_ID],
    ],
  },
  // `mdast-util-to-hast`'s footnote handlers already apply their own
  // `user-content-` clobber prefix (default) to build matching `id`/`href`
  // pairs (`footnote-reference.js`). `hast-util-sanitize`'s clobbering only
  // ever rewrites `id`/`name`/aria attributes, never `href` — leaving its
  // own default prefix enabled here would re-prefix just the `id` half of
  // each pair, breaking the `href="#..."` link to it. Disabling it here
  // keeps the single prefix `remark-rehype` already applied consistently.
  //
  // That much is unchanged. What changed is *why disabling it is safe*.
  // It used to be safe only incidentally: raw HTML was the one route to an
  // author-chosen `id`, and raw HTML was silently dropped, so nothing
  // unprefixed could exist to disable prefixing for. `rehype-raw` retires
  // that accident. The reasoning is now positive rather than residual:
  // `name` is not allowed on any element, and `id` is allowed only when it
  // is one of `MACHINE_MINTED_IDS` — the exact shapes `remark-rehype`
  // minted one step earlier. Every one of those contains a `-` or is the
  // literal `footnote-label`, so none is a valid JavaScript identifier and
  // none can become a `window.<name>` handle through named access. Author
  // HTML therefore plants no DOM-clobbering surface in a page the reader
  // renders with `v-html`, and `name` — the `document.currentScript` and
  // form-scoped-named-access route — is gone outright.
  //
  // The residual this leaves is deliberate and bounded, not overlooked.
  // `rehype-raw` reserializes and reparses the whole document, which
  // erases node identity, so the sanitiser cannot tell a machine-minted
  // `id` from an author-written one of the same shape: an author *can*
  // write `<div id="user-content-fn-1">` and duplicate a footnote's jump
  // target. That has no script consequence — it retargets an in-page
  // anchor inside a document whose entire text the same author already
  // controls — so it does not justify the per-render nonce that exact
  // provenance would cost. `render.test.ts` pins the boundary in both
  // directions: no other `id` shape survives, and this one does.
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
 *
 * 3: `rehype-raw` joined the pipeline, so a document's raw HTML renders
 * instead of being dropped (docs/TODO.md Finding, 2026-09-09). This is
 * exactly the case the constant exists for and the one the bump is easiest
 * to forget: the Markdown of an affected page did not change, so
 * `content_hash` is identical and every already-cached `rendered_html`
 * still holds the empty gap the fix removes. Without the bump the fix
 * reaches only pages saved after it ships, and the author who reported a
 * blank runbook still sees a blank runbook.
 * `backfillStaleRenders` (`packages/db/src/content/backfill-render.ts`)
 * re-renders every row with `pipeline_version < CURRENT_PIPELINE_VERSION`,
 * which is what carries the fix to the existing corpus.
 *
 * 4: `data-derived-block-id` on every unanchored paragraph and heading
 * (`DERIVED_BLOCK_ID` above), so a reader can start a thread on a block
 * that has no persisted anchor yet. Same shape as 3: the Markdown did not
 * change, so only the bump carries the attribute to the existing corpus.
 * Until the backfill reaches a page, its unanchored blocks simply offer no
 * comment affordance — degraded, never wrong.
 */
export const CURRENT_PIPELINE_VERSION = 4;

/**
 * Removes a `className` that sanitisation emptied rather than removed.
 * `hast-util-sanitize` filters a class *list* value-by-value, so a `<span>`
 * whose classes all fail `SANITIZE_SCHEMA`'s allowlist keeps the property
 * with an empty array behind it, and `hast-util-to-html` faithfully writes
 * that out as `class=""`. Now that raw HTML reaches the allowlist, that is
 * the ordinary outcome for any authored `<span class="...">` — so without
 * this the cached read-mode HTML would carry an empty attribute on every
 * one of them.
 */
function dropEmptiedClassName() {
  return (tree: HastRoot): undefined => {
    visit(tree, 'element', (node) => {
      const className = node.properties?.className;
      if (Array.isArray(className) && className.length === 0) delete node.properties.className;
    });
  };
}

const renderTransform = unified()
  .use(remarkRehype, {
    allowDangerousHtml: true,
    handlers: {
      wikiLink: wikiLinkHandler,
      tag: tagHandler,
      blockAnchor: blockAnchorHandler,
    },
  })
  // `allowDangerousHtml` above turns each mdast `html` node into a hast
  // `raw` node — a string of unparsed HTML. `rehypeSanitize` handles only
  // `root`, `element`, `text`, comment and doctype nodes, so without this
  // plugin it dropped every `raw` node wholesale and a document's raw HTML
  // (bucket B, "Verbatim", SPECS §5.1) rendered as an empty gap. `rehype-raw`
  // reparses those strings into real elements so the allowlist below can vet
  // them; it must run *before* the sanitiser, never after.
  .use(rehypeRaw)
  .use(rehypeSanitize, SANITIZE_SCHEMA)
  .use(dropEmptiedClassName);

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
  // The same slicing `mintAnchorAtBlock` performs on the way back in: a
  // derived id emitted here is, by construction, the one that call will
  // find when the reader posts it — as long as the document has not
  // changed since, which is exactly what a content-hashed id checks.
  const slices = sliceBlocks(tree, markdown);
  tree.children.forEach((child, index) => {
    const anchor = findBlockAnchor(child);
    if (!anchor) {
      // Only a block a persisted anchor could later live on gets a derived
      // id (`ANCHORABLE_BLOCKS`: paragraph and heading at this level). A
      // list, a code block or a table cannot carry ` ^id`, so an identity
      // for one would be an affordance that fails at the mint.
      if (!isAnchorableBlock(child)) return;
      const existingData = child.data as { hProperties?: Record<string, unknown> } | undefined;
      child.data = { ...child.data, hProperties: { ...existingData?.hProperties, dataDerivedBlockId: slices[index]!.id } };
      return;
    }
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
  });

  const hast = renderTransform.runSync(tree);
  return toHtml(hast);
}

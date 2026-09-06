import type { Node, Parent } from 'unist';
import { visit } from 'unist-util-visit';

/**
 * Custom mdast node produced by `applyBlockAnchors`, representing a
 * persisted block-ID anchor (design.md "Block identity" — Obsidian-style
 * trailing ` ^id`). Lives as the last inline child of the block it anchors.
 * WU-6's `classify()` folds this into a block-level attribute on the
 * ProseMirror node; at the mdast layer it is its own node so the extension
 * can be tested and reused independently of the schema.
 */
export interface BlockAnchorNode extends Node {
  type: 'blockAnchor';
  id: string;
}

declare module 'mdast' {
  interface PhrasingContentMap {
    blockAnchor: BlockAnchorNode;
  }
  interface RootContentMap {
    blockAnchor: BlockAnchorNode;
  }
}

/**
 * Private-use sentinel standing in for an escaped `^` while the raw string
 * is handed to remark-parse. CommonMark treats `^` as ordinary escapable
 * punctuation, so a bare `\^` would already have been collapsed to a literal
 * `^` by the time any mdast node exists — indistinguishable from a real
 * anchor marker. Protecting it at the string level, before parsing, is what
 * keeps the distinction alive long enough to extract real anchors correctly.
 */
const ESCAPED_CARET_SENTINEL = '\uE000';

const TRAILING_ANCHOR = / \^([0-9A-Za-z]+)$/;

/** Protects `\^` sequences in raw Markdown before it reaches remark-parse. */
export function protectEscapedCarets(markdown: string): string {
  return markdown.replaceAll('\\^', ESCAPED_CARET_SENTINEL);
}

interface TextLike extends Node {
  type: 'text';
  value: string;
}

function isTextNode(node: Node): node is TextLike {
  return node.type === 'text' && typeof (node as TextLike).value === 'string';
}

/**
 * The inline (phrasing) children array a trailing anchor could live in.
 * Paragraphs and headings hold phrasing content directly; a list item's own
 * children are block-level, so this descends into its last child once.
 */
function phrasingChildrenOf(node: Node): Node[] | undefined {
  if (node.type === 'listItem') {
    const children = (node as Parent).children;
    const last = children[children.length - 1];
    return last && 'children' in last ? (last as Parent).children : undefined;
  }
  if (node.type === 'paragraph' || node.type === 'heading') {
    return (node as Parent).children;
  }
  return undefined;
}

const ANCHORABLE_BLOCKS = new Set(['paragraph', 'heading', 'listItem']);

/**
 * Whether `node` is a kind of block a persisted anchor can live on, and if
 * so, the `blockAnchor` node it currently carries (already applied by
 * `applyBlockAnchors`), if any. Exported for `block-index.ts`, which needs
 * the same notion of "the owning block" without duplicating it.
 */
export function findBlockAnchor(node: Node): BlockAnchorNode | undefined {
  if (!ANCHORABLE_BLOCKS.has(node.type)) return undefined;
  const children = phrasingChildrenOf(node);
  if (!children || children.length === 0) return undefined;
  const last = children[children.length - 1];
  return last?.type === 'blockAnchor' ? (last as BlockAnchorNode) : undefined;
}

/**
 * Extracts a trailing ` ^id` from an anchorable block's own last text run
 * into a `blockAnchor` node appended after it, and restores every remaining
 * protected caret back to a literal `^` everywhere else in the tree.
 * (markdown-pipeline: Block Index And In-Text Anchors Stay In Sync)
 */
export function applyBlockAnchors(tree: Node): Node {
  visit(tree, (node: Node) => {
    if (!ANCHORABLE_BLOCKS.has(node.type)) return;
    const children = phrasingChildrenOf(node);
    if (!children || children.length === 0) return;

    const last = children[children.length - 1];
    if (!last || !isTextNode(last)) return;

    const match = TRAILING_ANCHOR.exec(last.value);
    if (!match) return;

    last.value = last.value.slice(0, match.index);
    const anchor: BlockAnchorNode = { type: 'blockAnchor', id: match[1]! };
    children.push(anchor);
  });

  visit(tree, (node: Node) => {
    if (isTextNode(node) && node.value.includes(ESCAPED_CARET_SENTINEL)) {
      node.value = node.value.replaceAll(ESCAPED_CARET_SENTINEL, '^');
    }
  });

  return tree;
}

/** `mdast-util-to-markdown` handler for `blockAnchor` nodes. */
export function blockAnchorToMarkdown(node: BlockAnchorNode): string {
  return ` ^${node.id}`;
}

/**
 * Before stringifying, marks any literal trailing `^id`-shaped text that
 * carries no `blockAnchor` node with the same sentinel `protectEscapedCarets`
 * uses, so it is not misread as an anchor when the output is parsed again.
 * The sentinel is inserted into `.value` — not a literal backslash — because
 * a literal backslash placed in a text node's semantic value would itself
 * get escaped by the generic serialiser, doubling up. `restoreEscapedCarets`
 * converts the sentinel to the real `\^` spelling in the final output
 * string, after serialisation. Inverse half of `protectEscapedCarets`.
 */
export function markCaretsForEscaping(tree: Node): Node {
  visit(tree, (node: Node) => {
    if (!ANCHORABLE_BLOCKS.has(node.type)) return;
    const children = phrasingChildrenOf(node);
    if (!children || children.length === 0) return;
    if (children[children.length - 1]?.type === 'blockAnchor') return; // a real anchor, not escaped text

    const last = children[children.length - 1];
    if (!last || !isTextNode(last)) return;

    if (TRAILING_ANCHOR.test(last.value)) {
      last.value = last.value.replace(TRAILING_ANCHOR, (_full, id: string) => ` ${ESCAPED_CARET_SENTINEL}${id}`);
    }
  });
  return tree;
}

/** Converts the sentinel left by `markCaretsForEscaping` into the literal `\^` spelling, in the final serialised string. */
export function restoreEscapedCarets(output: string): string {
  return output.replaceAll(ESCAPED_CARET_SENTINEL, '\\^');
}

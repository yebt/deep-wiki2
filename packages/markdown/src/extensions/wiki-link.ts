import type { Parent, PhrasingContent, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

/** The resolved identity of a page a wiki-link points at. */
export interface WikiLinkTarget {
  id: string;
}

/**
 * Pure lookup from a wiki-link's target title to a resolved page identity.
 * No I/O happens inside `packages/markdown` — a caller with access to the
 * page registry (e.g. `packages/db` on save) supplies this.
 */
export type WikiLinkResolver = (title: string) => WikiLinkTarget | undefined;

/** Custom mdast node produced by `applyWikiLinks`. */
export interface WikiLinkNode extends Parent {
  type: 'wikiLink';
  /** The literal `[[...]]` text as written; reserialised unchanged. */
  raw: string;
  target: string;
  anchor?: string;
  alias?: string;
  resolved?: WikiLinkTarget;
  children: PhrasingContent[];
}

declare module 'mdast' {
  interface PhrasingContentMap {
    wikiLink: WikiLinkNode;
  }
  interface RootContentMap {
    wikiLink: WikiLinkNode;
  }
}

const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/**
 * Walks `tree`, replacing every `[[Target]]` / `[[Target#anchor]]` /
 * `[[Target|Alias]]` occurrence inside plain text with a `wikiLink` node.
 * (markdown-pipeline: Wiki-Link Parsing And Normalisation)
 */
export function applyWikiLinks(tree: Root, resolve?: WikiLinkResolver): Root {
  visit(tree, 'text', (node: Text, index, parent) => {
    if (!parent || index === undefined) return undefined;

    const value = node.value;
    WIKI_LINK_PATTERN.lastIndex = 0;
    if (!WIKI_LINK_PATTERN.test(value)) return undefined;
    WIKI_LINK_PATTERN.lastIndex = 0;

    const replacement: Array<Text | WikiLinkNode> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK_PATTERN.exec(value))) {
      const raw = match[0];
      const rawTarget = match[1] ?? '';
      const rawAnchor = match[2];
      const rawAlias = match[3];
      if (match.index > lastIndex) {
        replacement.push({ type: 'text', value: value.slice(lastIndex, match.index) });
      }
      const target = rawTarget.trim();
      const anchor = rawAnchor?.trim();
      const alias = rawAlias?.trim();
      replacement.push({
        type: 'wikiLink',
        raw,
        target,
        anchor,
        alias,
        resolved: resolve?.(target),
        children: [{ type: 'text', value: alias ?? target }],
      });
      lastIndex = match.index + raw.length;
    }
    if (lastIndex < value.length) {
      replacement.push({ type: 'text', value: value.slice(lastIndex) });
    }

    (parent as Parent).children.splice(index, 1, ...(replacement as PhrasingContent[]));
    return index + replacement.length;
  });

  return tree;
}

/**
 * `mdast-util-to-markdown` handler for `wikiLink` nodes. Reserialises the
 * literal source it was parsed from, so resolution status never changes the
 * output bytes (markdown-round-trip: Wiki-Link Round Trip, Resolved and
 * Unresolved).
 */
export function wikiLinkToMarkdown(node: WikiLinkNode): string {
  if (node.raw) return node.raw;

  // No `raw` (e.g. a wiki-link constructed programmatically, such as by the
  // editor): reconstruct the canonical spelling from its parts.
  let out = `[[${node.target}`;
  if (node.anchor) out += `#${node.anchor}`;
  if (node.alias) out += `|${node.alias}`;
  return `${out}]]`;
}

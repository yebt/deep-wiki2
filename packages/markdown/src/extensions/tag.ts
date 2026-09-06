import type { Parent, PhrasingContent, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

/** Custom mdast node produced by `applyTags`. */
export interface TagNode extends Parent {
  type: 'tag';
  name: string;
  children: [];
}

declare module 'mdast' {
  interface PhrasingContentMap {
    tag: TagNode;
  }
  interface RootContentMap {
    tag: TagNode;
  }
}

// A `#` heading marker never reaches this pattern: remark-parse already
// consumes it as heading syntax before any text node exists, and `#` inside
// inline code lives in a separate `inlineCode` node's `.value` that this
// visitor never touches. Requires a leading boundary (start-of-text or
// whitespace) so `color#fff` is not mistaken for a tag.
const TAG_PATTERN = /(^|\s)#([A-Za-z][\w-]*)/g;

/** (markdown-pipeline: Tag Parsing) */
export function applyTags(tree: Root): Root {
  visit(tree, 'text', (node: Text, index, parent) => {
    if (!parent || index === undefined) return undefined;

    const value = node.value;
    TAG_PATTERN.lastIndex = 0;
    if (!TAG_PATTERN.test(value)) return undefined;
    TAG_PATTERN.lastIndex = 0;

    const replacement: Array<Text | TagNode> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_PATTERN.exec(value))) {
      const full = match[0];
      const boundary = match[1] ?? '';
      const name = match[2] ?? '';
      const matchStart = match.index + boundary.length;
      if (matchStart > lastIndex) {
        replacement.push({ type: 'text', value: value.slice(lastIndex, matchStart) });
      }
      replacement.push({ type: 'tag', name, children: [] });
      lastIndex = match.index + full.length;
    }
    if (lastIndex < value.length) {
      replacement.push({ type: 'text', value: value.slice(lastIndex) });
    }

    (parent as Parent).children.splice(index, 1, ...(replacement as PhrasingContent[]));
    return index + replacement.length;
  });

  return tree;
}

/** `mdast-util-to-markdown` handler for `tag` nodes. */
export function tagToMarkdown(node: TagNode): string {
  return `#${node.name}`;
}

/**
 * Walks `tree` and returns every distinct tag name, in first-seen order
 * (knowledge-graph: Tags And Page-Tag Associations Are Rebuilt On Save).
 */
export function collectTags(tree: Root): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  visit(tree, 'tag', (node: TagNode) => {
    if (!seen.has(node.name)) {
      seen.add(node.name);
      names.push(node.name);
    }
  });

  return names;
}

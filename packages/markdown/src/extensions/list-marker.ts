import { defaultHandlers, type Handle } from 'mdast-util-to-markdown';
import type { List, Root } from 'mdast';
import { visit } from 'unist-util-visit';

type BulletChar = '-' | '*' | '+';

/**
 * mdast normalises away which literal bullet character (`-`, `*`, `+`) an
 * unordered list used in its source — every `list` node looks the same
 * regardless of marker. A top-level list always canonicalises onto the
 * pinned `-` (that is what makes `pin-bullet.md`'s efficacy test meaningful).
 * A *nested* list — a list whose own parent is a `listItem` — is different:
 * the round-trip spec requires it to keep its own depth's original marker
 * rather than collapsing onto the same character as its parent
 * (markdown-round-trip: Nested List Preservation). This captures that
 * original character from the source string via the node's own start
 * offset, the one place that information still exists, and only for lists
 * at depth ≥ 1.
 */
export function applyListMarkers(tree: Root, source: string): Root {
  visit(tree, 'list', (node: List, _index, parent) => {
    if (node.ordered) return;
    if (parent?.type !== 'listItem') return; // top-level: always the pin

    const offset = node.position?.start.offset;
    if (offset === undefined) return;
    const char = source[offset];
    if (char === '-' || char === '*' || char === '+') {
      (node as List & { data?: Record<string, unknown> }).data = {
        ...(node as List & { data?: Record<string, unknown> }).data,
        bulletChar: char satisfies BulletChar,
      };
    }
  });
  return tree;
}

/**
 * `mdast-util-to-markdown` handler for `list` nodes: temporarily overrides
 * the pinned `bullet` option with this list's own captured marker, then
 * delegates to the library's default list serialiser.
 */
export const listToMarkdown: Handle = (node, parent, state, info) => {
  const listNode = node as List & { data?: { bulletChar?: BulletChar } };
  const bulletChar = listNode.data?.bulletChar;
  if (!bulletChar) return defaultHandlers.list(node, parent, state, info);

  const previous = state.options.bullet;
  state.options.bullet = bulletChar;
  try {
    return defaultHandlers.list(node, parent, state, info);
  } finally {
    state.options.bullet = previous;
  }
};

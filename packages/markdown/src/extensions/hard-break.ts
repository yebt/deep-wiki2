import type { Break, Root } from 'mdast';
import { visit } from 'unist-util-visit';

type BreakSpelling = 'space' | 'backslash';

/**
 * mdast-util-to-markdown's default `break` handler always emits the
 * trailing-backslash spelling; there is no built-in option to choose the
 * other one. The round-trip spec requires BOTH source spellings — trailing
 * double-space and trailing backslash — to be preserved as originally
 * written, with neither normalised into the other (markdown-round-trip:
 * Hard Line Break Spelling Preservation). This captures which one was used
 * from the source, via the node's own position span.
 */
export function applyBreakSpellings(tree: Root, source: string): Root {
  visit(tree, 'break', (node: Break) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;

    const raw = source.slice(start, end);
    const spelling: BreakSpelling = raw.startsWith('\\') ? 'backslash' : 'space';
    (node as Break & { data?: Record<string, unknown> }).data = {
      ...(node as Break & { data?: Record<string, unknown> }).data,
      spelling,
    };
  });
  return tree;
}

/** `mdast-util-to-markdown` handler for `break` nodes. */
export function breakToMarkdown(node: Break & { data?: { spelling?: BreakSpelling } }): string {
  return node.data?.spelling === 'space' ? '  \n' : '\\\n';
}

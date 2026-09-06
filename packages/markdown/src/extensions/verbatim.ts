import type { Node } from 'unist';

/**
 * Generic carriers for bucket-B content (design.md "carried verbatim"),
 * produced only by `packages/editor`'s `to-markdown.ts` when converting a
 * ProseMirror `verbatim`/`verbatimInline` atom back into markdown —
 * `packages/markdown`'s own `parse()` never emits these; it produces the
 * native mdast type (`html`, `definition`, `linkReference`,
 * `imageReference`, `yaml`) directly, same as remark always has. This pair
 * exists so the editor does not have to reconstruct each native type's own
 * structured fields (a `definition`'s `identifier`/`url`/`title`, for
 * example) just to re-emit the literal bytes it already has.
 */
export interface VerbatimNode extends Node {
  type: 'verbatim';
  raw: string;
}

export interface VerbatimInlineNode extends Node {
  type: 'verbatimInline';
  raw: string;
}

declare module 'mdast' {
  interface RootContentMap {
    verbatim: VerbatimNode;
    verbatimInline: VerbatimInlineNode;
  }
  interface PhrasingContentMap {
    verbatimInline: VerbatimInlineNode;
  }
}

/** `mdast-util-to-markdown` handler for `verbatim` nodes: the raw bytes, unchanged. */
export function verbatimToMarkdown(node: VerbatimNode): string {
  return node.raw;
}

/** `mdast-util-to-markdown` handler for `verbatimInline` nodes: the raw bytes, unchanged. */
export function verbatimInlineToMarkdown(node: VerbatimInlineNode): string {
  return node.raw;
}

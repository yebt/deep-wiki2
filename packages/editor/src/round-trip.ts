import { fromMarkdown } from './from-markdown';
import { toMarkdown } from './to-markdown';

/**
 * GATE-2's md -> ProseMirror doc -> md byte-identity harness
 * (docs/TODO.md; markdown-round-trip spec). Routes through
 * `packages/editor`'s own schema functions, not only
 * `packages/markdown`'s `parse`/`stringify` — a construct the schema does
 * not yet model (a footnote before this phase modelled it, for example)
 * fails here even though a naive mdast-only round trip would pass.
 */
export function roundTrip(markdown: string): string {
  return toMarkdown(fromMarkdown(markdown));
}

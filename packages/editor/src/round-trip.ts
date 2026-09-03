import { parse, stringify } from '@deep-wiki/markdown';

/**
 * md -> mdast -> md byte-identity harness (GATE-2, docs/TODO.md). This is
 * a placeholder for the eventual md -> ProseMirror doc -> md round trip:
 * it reuses `packages/markdown` for both directions so there is still
 * exactly one parser/serializer pair in the codebase. ProseMirror slots
 * into this same corpus once `packages/editor` grows a real editing
 * surface — the harness and fixtures do not change shape when that lands.
 */
export function roundTrip(markdown: string): string {
  return stringify(parse(markdown));
}

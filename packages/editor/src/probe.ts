import { fromMarkdown } from './from-markdown';
import { toMarkdown } from './to-markdown';

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported_construct' | 'not_byte_identical'; construct?: string };

const UNSUPPORTED_PATTERN = /unsupported (?:block|inline) node type "([^"]+)"/;

/**
 * The per-document fail-closed check (design.md "Fail-closed: the
 * per-document probe"): `toMarkdown(fromMarkdown(md)) === md`. Edit mode
 * only opens when this holds; a document whose constructs the schema
 * neither models nor carries verbatim is refused, not silently opened and
 * dropped (markdown-round-trip: Unrepresentable Content Fails Closed).
 */
export function probe(markdown: string): ProbeResult {
  try {
    const doc = fromMarkdown(markdown);
    const back = toMarkdown(doc);
    if (back === markdown) return { ok: true };
    return { ok: false, reason: 'not_byte_identical' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = UNSUPPORTED_PATTERN.exec(message);
    return { ok: false, reason: 'unsupported_construct', construct: match?.[1] };
  }
}

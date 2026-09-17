/**
 * The visual ↔ source toggle of edit mode as a pure decision (owner
 * decision, 2026-09-17, "source mode, like Obsidian"). The page owns the
 * markdown — the edit session's buffer is the truth, whichever view is
 * up — and this decides which view may show it next:
 *
 * - **visual → source** is always granted. The source is `toMarkdown` of
 *   the live document, canonical by construction.
 * - **source → visual** is granted only when the probe says the text is
 *   its own fixed point (`packages/editor/src/probe.ts`: `toMarkdown(
 *   fromMarkdown(md)) === md`). Otherwise the person stays in source
 *   with a refusal that names what is not canonical, by example — the
 *   typed line beside its canonical spelling — and nothing they typed is
 *   rewritten for them. The same fail-closed rule the edit-session route
 *   applies before opening a page (document-modes spec), applied to the
 *   text a person just wrote.
 *
 * Pure: the probe and the canonicaliser are passed in, so
 * `editor-view.test.ts` drives every branch without the editor chunk.
 */
export type EditorViewMode = 'visual' | 'source';

/** The two views, in the order the segmented control draws them. */
export const EDITOR_VIEWS: readonly EditorViewMode[] = ['visual', 'source'];

/** `probe()`'s result shape, as `@deep-wiki/editor` declares it — restated so this file needs no import from the editor chunk. */
export type ProbeResultLike =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unsupported_construct'; readonly construct: string; readonly line: number }
  | { readonly ok: false; readonly reason: 'not_byte_identical'; readonly line: number };

export type ProbeLike = (markdown: string) => ProbeResultLike;

/** `toMarkdown(fromMarkdown(markdown))` — what a save would write back. Only consulted for a `not_byte_identical` refusal. */
export type CanonicaliseLike = (markdown: string) => string;

/**
 * Why the source cannot open in the visual view. `typed` is the offending
 * line as written; `canonical` is that line as the pipeline would write
 * it (`null` when the construct cannot be written at all); `construct` is
 * the probe's own name for an unsupported construct, `null` when the
 * text parses but does not round-trip.
 */
export interface SourceRefusal {
  readonly line: number;
  readonly typed: string;
  readonly canonical: string | null;
  readonly construct: string | null;
}

export interface ViewDecision {
  readonly view: EditorViewMode;
  readonly refusal: SourceRefusal | null;
}

function lineOf(text: string, line: number): string {
  return text.split('\n')[line - 1] ?? '';
}

/** The refusal for a probe that said no, with the lines it points at read out of the texts. */
export function describeRefusal(source: string, result: Exclude<ProbeResultLike, { ok: true }>, canonicalise: CanonicaliseLike): SourceRefusal {
  if (result.reason === 'unsupported_construct') {
    return { line: result.line, typed: lineOf(source, result.line), canonical: null, construct: result.construct };
  }
  return { line: result.line, typed: lineOf(source, result.line), canonical: lineOf(canonicalise(source), result.line), construct: null };
}

/** The view to show after asking for `target` while `current` is up, given the source text as it stands. */
export function requestView(
  target: EditorViewMode,
  current: EditorViewMode,
  source: string,
  probe: ProbeLike,
  canonicalise: CanonicaliseLike,
): ViewDecision {
  if (target === current) return { view: current, refusal: null };
  if (target === 'source') return { view: 'source', refusal: null };
  const result = probe(source);
  if (result.ok) return { view: 'visual', refusal: null };
  return { view: 'source', refusal: describeRefusal(source, result, canonicalise) };
}

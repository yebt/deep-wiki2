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
 *   fromMarkdown(md)) === md`). Otherwise the person stays in source with
 *   a refusal that names the line, and nothing they typed is rewritten
 *   behind them. The same fail-closed rule the edit-session route applies
 *   before opening a page (document-modes spec), applied to the text a
 *   person just wrote.
 *
 * ── A formatter, not a wall (owner decision, 2026-09-23) ───────────────
 *
 * The refusal used to be the whole answer, and the owner's words were "es
 * mejor trabajar con un formateador o algo así para que me permita
 * manejarlo". `formatSource` is that second decision: one action rewrites
 * the buffer to its canonical form — the bytes a save requires anyway
 * (page-content spec, D1) — and the visual view opens on it. The person
 * sees exactly what changed, because the text in front of them changes;
 * nothing is rewritten *behind* them, which is the property the refusal
 * existed to protect in the first place.
 *
 * The wall stays for the one case where canonicalising cannot help: a
 * construct the schema does not model. `canonicalise` here is
 * `toMarkdown(fromMarkdown(md))`, and `fromMarkdown` **throws**
 * (`UnsupportedConstructError`) rather than dropping such a construct —
 * so "formatting would lose something" arrives as a throw, and is
 * answered by rewriting nothing and keeping the refusal. There is no case
 * in which this canonicaliser returns a document with less in it than it
 * was given; that is what the throw is for. A successful format changes
 * spelling, never content.
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

/** `toMarkdown(fromMarkdown(markdown))` — the canonical form of the buffer, and what a save would write back. */
export type CanonicaliseLike = (markdown: string) => string;

/**
 * The offending line as written beside the same line as the pipeline would
 * write it.
 *
 * The two travel together, and they are `null` together, because the
 * notice promises both or neither. That is the 2026-09-23 defect stated as
 * a type: `probe()` reports the line at which the *bytes* first diverge,
 * which for the commonest non-canonical text a person produces — one blank
 * line too many, two newlines at the end of the buffer — is a **blank
 * line**, so both "spellings" were the empty string and the notice read
 * "As typed: — canonical:". Two empty code spans are worse than no
 * example at all.
 */
export interface RefusalSpellings {
  readonly typed: string;
  readonly canonical: string;
}

/**
 * Why the source cannot open in the visual view. `construct` is the
 * probe's own name for a construct the schema does not model, `null` when
 * the text parses but does not round-trip; `formattable` says whether
 * canonicalising the buffer is a way out (it is exactly when there is no
 * unsupported construct); `spellings` is the example, when there is one.
 */
export interface SourceRefusal {
  readonly line: number;
  readonly spellings: RefusalSpellings | null;
  readonly construct: string | null;
  readonly formattable: boolean;
}

export interface ViewDecision {
  readonly view: EditorViewMode;
  readonly refusal: SourceRefusal | null;
}

/** What formatting the buffer did, and where that leaves the person. */
export interface FormatDecision {
  /** The canonical bytes to put in the buffer, or `null` when nothing was rewritten. */
  readonly markdown: string | null;
  readonly view: EditorViewMode;
  readonly refusal: SourceRefusal | null;
}

function lineOf(text: string, line: number): string {
  return text.split('\n')[line - 1] ?? '';
}

/**
 * The two spellings of the offending line, or `null` when there is nothing
 * to show: a blank line on either side, a line past the end of the
 * canonical text (`lineOf` answers `''`), two spellings that are the same
 * text — a missing trailing newline diverges on a line whose two
 * spellings are the same word — or a canonicaliser that cannot serialise
 * the document at all.
 */
function spellingsOf(source: string, line: number, canonicalise: CanonicaliseLike): RefusalSpellings | null {
  const typed = lineOf(source, line);
  if (typed === '') return null;
  let canonical: string;
  try {
    canonical = lineOf(canonicalise(source), line);
  } catch {
    return null;
  }
  if (canonical === '' || canonical === typed) return null;
  return { typed, canonical };
}

/** The refusal for a probe that said no, with the example read out of the texts when there is one. */
export function describeRefusal(source: string, result: Exclude<ProbeResultLike, { ok: true }>, canonicalise: CanonicaliseLike): SourceRefusal {
  if (result.reason === 'unsupported_construct') {
    return { line: result.line, spellings: null, construct: result.construct, formattable: false };
  }
  return { line: result.line, spellings: spellingsOf(source, result.line, canonicalise), construct: null, formattable: true };
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

/**
 * Format: the buffer, rewritten to its canonical form, and then the same
 * question `requestView` asks — may the visual view open on it?
 *
 * The probe runs against the *formatted* text rather than being assumed to
 * pass, because the two conditions are not the same one: formatting is
 * about spelling, and the visual view is about what the schema models. A
 * canonical document that still does not round-trip keeps the person in
 * source with the refusal restated about the text they now have.
 */
export function formatSource(source: string, probe: ProbeLike, canonicalise: CanonicaliseLike): FormatDecision {
  let formatted: string;
  try {
    formatted = canonicalise(source);
  } catch {
    // Canonicalising would lose something, so nothing is rewritten. The
    // probe's own account of the text is the honest refusal to keep.
    const result = probe(source);
    return { markdown: null, view: 'source', refusal: result.ok ? null : describeRefusal(source, result, canonicalise) };
  }

  const rewritten = formatted === source ? null : formatted;
  const result = probe(formatted);
  if (result.ok) return { markdown: rewritten, view: 'visual', refusal: null };
  return { markdown: rewritten, view: 'source', refusal: describeRefusal(formatted, result, canonicalise) };
}

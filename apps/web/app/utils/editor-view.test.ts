import { describe, expect, test } from 'vitest';
import { describeRefusal, EDITOR_VIEWS, formatSource, requestView, type CanonicaliseLike, type ProbeLike } from './editor-view';

/**
 * The visual ↔ source toggle as a pure decision (owner decision,
 * 2026-09-17, "source mode, like Obsidian"): the page holds the markdown,
 * this decides which view may show it. Leaving the visual view is always
 * allowed — `toMarkdown` of the live document is canonical by
 * construction. Leaving the source view is allowed only when the probe
 * says the text is its own fixed point.
 *
 * Since 2026-09-23 the refusal is not the end of it: the owner asked for
 * "un formateador" rather than a wall, so `formatSource` is the second
 * decision — rewrite the buffer to its canonical form and let the visual
 * view open — and the refusal it replaces carries its two spellings only
 * when it genuinely has two to show.
 */
const CANONICAL: ProbeLike = () => ({ ok: true });

describe('requestView', () => {
  test('lists the two views, visual first', () => {
    expect(EDITOR_VIEWS).toEqual(['visual', 'source']);
  });

  test('visual → source is always granted, without consulting the probe', () => {
    let probed = 0;
    const probe: ProbeLike = () => {
      probed += 1;
      return { ok: false, reason: 'not_byte_identical', line: 1 };
    };
    expect(requestView('source', 'visual', 'anything', probe, () => '')).toEqual({ view: 'source', refusal: null });
    expect(probed).toBe(0);
  });

  test('source → visual is granted when the source is canonical', () => {
    expect(requestView('visual', 'source', '# Title\n', CANONICAL, () => '# Title\n')).toEqual({ view: 'visual', refusal: null });
  });

  test('asking for the view already shown changes nothing and probes nothing', () => {
    let probed = 0;
    const probe: ProbeLike = () => {
      probed += 1;
      return { ok: true };
    };
    expect(requestView('source', 'source', '**x**\n', probe, () => '')).toEqual({ view: 'source', refusal: null });
    expect(requestView('visual', 'visual', '**x**\n', probe, () => '')).toEqual({ view: 'visual', refusal: null });
    expect(probed).toBe(0);
  });

  test('source → visual is refused when the source is not canonical: the view stays, the refusal names the line', () => {
    const probe: ProbeLike = () => ({ ok: false, reason: 'not_byte_identical', line: 3 });
    const source = '# Title\n\nSay **bold** here.\n';
    const canonical = '# Title\n\nSay __bold__ here.\n';
    const result = requestView('visual', 'source', source, probe, () => canonical);

    expect(result.view).toBe('source');
    expect(result.refusal).toEqual({
      line: 3,
      spellings: { typed: 'Say **bold** here.', canonical: 'Say __bold__ here.' },
      construct: null,
      formattable: true,
    });
  });
});

describe('describeRefusal', () => {
  test('a non-canonical line is described by its typed and canonical spellings, so the construct is named by example', () => {
    const source = '# Title\n\nSay **bold** here.\n';
    const canonical = '# Title\n\nSay __bold__ here.\n';
    const refusal = describeRefusal(source, { ok: false, reason: 'not_byte_identical', line: 3 }, () => canonical);

    expect(refusal).toEqual({
      line: 3,
      spellings: { typed: 'Say **bold** here.', canonical: 'Say __bold__ here.' },
      construct: null,
      formattable: true,
    });
  });

  test('an unsupported construct is described by the name the probe gives it, and formatting is not a way out of it', () => {
    const refusal = describeRefusal('a\n\n<div>\n', { ok: false, reason: 'unsupported_construct', construct: 'a setext heading', line: 3 }, () => '');

    expect(refusal).toEqual({ line: 3, spellings: null, construct: 'a setext heading', formattable: false });
  });

  /**
   * The defect the owner reported on 2026-09-23: "As typed: — canonical:"
   * with nothing after either colon. `probe()` reports the line at which
   * the *bytes* first diverge, and for the commonest non-canonical text a
   * person produces — a blank line too many, or two newlines at the end of
   * the buffer — that line is blank in both texts. A notice that promises
   * two spellings and shows two empty code spans is worse than one that
   * names the line and stops, so the two spellings now travel together and
   * only when there is something in both of them.
   */
  test('a divergence on a blank line carries no spellings, because there are none to show', () => {
    const source = '# T\n\nA\n\nB\n\n\n\n';
    const canonical = '# T\n\nA\n\nB\n';
    const refusal = describeRefusal(source, { ok: false, reason: 'not_byte_identical', line: 6 }, () => canonical);

    expect(refusal).toEqual({ line: 6, spellings: null, construct: null, formattable: true });
  });

  test('a line past the end of the canonical text carries no spellings either', () => {
    const refusal = describeRefusal('a\n', { ok: false, reason: 'not_byte_identical', line: 9 }, () => 'a\n\nb\n');

    expect(refusal).toEqual({ line: 9, spellings: null, construct: null, formattable: true });
  });

  /**
   * A missing trailing newline diverges on a line whose two spellings are
   * the same word: "As typed: A — canonical: A" promises a difference and
   * then shows none.
   */
  test('two identical spellings are no spellings: the notice must not claim a difference it cannot show', () => {
    const refusal = describeRefusal('# T\n\nA', { ok: false, reason: 'not_byte_identical', line: 3 }, () => '# T\n\nA\n');

    expect(refusal).toEqual({ line: 3, spellings: null, construct: null, formattable: true });
  });

  test('a canonicaliser that cannot serialise the text at all leaves the spellings out rather than throwing', () => {
    const refusal = describeRefusal('a\n', { ok: false, reason: 'not_byte_identical', line: 1 }, () => {
      throw new Error('nope');
    });

    expect(refusal).toEqual({ line: 1, spellings: null, construct: null, formattable: true });
  });
});

describe('formatSource', () => {
  const canonicalise: CanonicaliseLike = (markdown) => markdown.replaceAll('**', '__').replace(/\n*$/, '\n');

  test('the non-canonical buffer is rewritten to its canonical form and the visual view opens', () => {
    const probe: ProbeLike = (markdown) => (markdown.includes('**') ? { ok: false, reason: 'not_byte_identical', line: 1 } : { ok: true });

    expect(formatSource('Say **bold** here.\n', probe, canonicalise)).toEqual({
      markdown: 'Say __bold__ here.\n',
      view: 'visual',
      refusal: null,
    });
  });

  test('a buffer that is already its own canonical form is not rewritten, and the probe decides the view', () => {
    expect(formatSource('Say __bold__ here.\n', CANONICAL, canonicalise)).toEqual({ markdown: null, view: 'visual', refusal: null });
  });

  /**
   * Formatting is about spelling; the visual view is about what the schema
   * models. A document whose canonical form still does not round-trip is
   * formatted anyway — the bytes a save wants are the bytes now on screen —
   * and the refusal is re-stated about the text as it now is, never about
   * the text the person no longer has.
   */
  test('a buffer whose canonical form still does not round-trip is rewritten, and the refusal is restated about the new text', () => {
    const probe: ProbeLike = () => ({ ok: false, reason: 'not_byte_identical', line: 1 });
    const decision = formatSource('Say **bold** here.\n', probe, canonicalise);

    expect(decision.markdown).toBe('Say __bold__ here.\n');
    expect(decision.view).toBe('source');
    expect(decision.refusal).toEqual({ line: 1, spellings: null, construct: null, formattable: true });
  });

  /**
   * The case the brief asks about: canonicalising that would lose
   * something. `canonicalise` is `toMarkdown(fromMarkdown(md))`, and
   * `fromMarkdown` throws `UnsupportedConstructError` rather than dropping
   * a construct the schema does not model — so "would lose something"
   * arrives as a throw, and the answer is to rewrite nothing and keep the
   * wall.
   */
  test('a canonicaliser that throws rewrites nothing and keeps the refusal the probe gives', () => {
    const probe: ProbeLike = () => ({ ok: false, reason: 'unsupported_construct', construct: 'a footnote definition', line: 4 });
    const decision = formatSource('[^1]: note\n', probe, () => {
      throw new Error('UnsupportedConstructError');
    });

    expect(decision).toEqual({
      markdown: null,
      view: 'source',
      refusal: { line: 4, spellings: null, construct: 'a footnote definition', formattable: false },
    });
  });
});

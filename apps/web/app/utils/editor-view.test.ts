import { describe, expect, test } from 'vitest';
import { describeRefusal, EDITOR_VIEWS, requestView, type ProbeLike } from './editor-view';

/**
 * The visual ↔ source toggle as a pure decision (owner decision,
 * 2026-09-17, "source mode, like Obsidian"): the page holds the markdown,
 * this decides which view may show it. Leaving the visual view is always
 * allowed — `toMarkdown` of the live document is canonical by
 * construction. Leaving the source view is allowed only when the probe
 * says the text is its own fixed point; otherwise the person stays in
 * source with a notice that names what is not canonical, and nothing is
 * rewritten for them.
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
    expect(result.refusal).toEqual({ line: 3, typed: 'Say **bold** here.', canonical: 'Say __bold__ here.', construct: null });
  });
});

describe('describeRefusal', () => {
  test('a non-canonical line is described by its typed and canonical spellings, so the construct is named by example', () => {
    const source = '# Title\n\nSay **bold** here.\n';
    const canonical = '# Title\n\nSay __bold__ here.\n';
    const refusal = describeRefusal(source, { ok: false, reason: 'not_byte_identical', line: 3 }, () => canonical);

    expect(refusal).toEqual({ line: 3, typed: 'Say **bold** here.', canonical: 'Say __bold__ here.', construct: null });
  });

  test('an unsupported construct is described by the name the probe gives it', () => {
    const refusal = describeRefusal('a\n\n<div>\n', { ok: false, reason: 'unsupported_construct', construct: 'a setext heading', line: 3 }, () => '');

    expect(refusal).toEqual({ line: 3, typed: '<div>', canonical: null, construct: 'a setext heading' });
  });

  test('a line past the end of either text is described as empty rather than crashing', () => {
    const refusal = describeRefusal('a\n', { ok: false, reason: 'not_byte_identical', line: 9 }, () => 'a\n\nb\n');

    expect(refusal).toEqual({ line: 9, typed: '', canonical: '', construct: null });
  });
});

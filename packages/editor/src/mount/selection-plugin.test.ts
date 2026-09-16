import { describe, expect, test } from 'bun:test';
import { GapCursor } from 'prosemirror-gapcursor';
import { EditorState, NodeSelection, TextSelection, type Plugin } from 'prosemirror-state';
import { fromMarkdown } from '../from-markdown';
import { schema } from '../schema';
import { createSelectionPlugin, selectionSnapshot, type SelectionReport } from './selection-plugin';
import { buildEditorPlugins } from './plugins';

/**
 * The bubble toolbar's input, in two halves: `selectionSnapshot` is the
 * DOM-free reducer (`from`/`to`/`empty`/which marks are active), and the
 * plugin's `view()` is the only place `coordsAtPos` is called — driven
 * here with a fake view whose `coordsAtPos` is a stub, so the DOM never
 * enters this package's tests.
 */

function stateOf(markdown: string, from: number, to = from): EditorState {
  const doc = fromMarkdown(markdown);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });
}

describe('selectionSnapshot: the DOM-free reducer', () => {
  test('a caret in plain text reports empty and no active marks', () => {
    // doc(paragraph("plain")): "p" is at 1.
    expect(selectionSnapshot(stateOf('plain text', 3))).toEqual({
      kind: 'text',
      from: 3,
      to: 3,
      empty: true,
      marks: { strong: false, emphasis: false, delete: false, inlineCode: false, link: false },
      link: null,
    });
  });

  test('a range entirely inside a strong run reports strong active, and a range straddling its edge does not', () => {
    // "__bold__ plain" -> paragraph(strong("bold"), " plain"); "bold" is 1..5.
    const inside = selectionSnapshot(stateOf('__bold__ plain', 2, 4));
    expect(inside).toMatchObject({ kind: 'text', from: 2, to: 4, empty: false });
    expect(inside.marks.strong).toBe(true);

    const straddling = selectionSnapshot(stateOf('__bold__ plain', 3, 8));
    expect(straddling.marks.strong).toBe(false);
  });

  test('every toolbar mark is reported independently', () => {
    const md = '**b** _e_ ~~d~~ `c` [l](https://x.test)';
    const doc = fromMarkdown(md);
    const paragraph = doc.firstChild!;
    // Walk the paragraph and probe a caret inside each marked run.
    const seen: string[] = [];
    paragraph.forEach((child, offset) => {
      const pos = offset + 2; // inside the run, past its first character
      const snapshot = selectionSnapshot(EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) }));
      const active = Object.entries(snapshot.marks)
        .filter(([, on]) => on)
        .map(([name]) => name);
      if (child.marks.length > 0) seen.push(active.join(','));
    });
    expect(seen).toEqual(['strong', 'emphasis', 'delete', 'inlineCode', 'link']);
  });

  test('a caret inside a link reports the link its Edit button prefills', () => {
    const md = 'see [the docs](https://example.com/docs "Docs") now';
    // "see " is 4 chars -> link text starts at 5.
    const snapshot = selectionSnapshot(stateOf(md, 7));
    expect(snapshot.marks.link).toBe(true);
    expect(snapshot.link).toEqual({ href: 'https://example.com/docs', title: 'Docs' });
  });

  test('a node selection and a gap cursor are reported by kind, with no marks active', () => {
    const doc = fromMarkdown('# Title\n\n***\n');
    const node = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, doc.content.size - 1) });
    expect(selectionSnapshot(node)).toMatchObject({ kind: 'node', empty: false, link: null });
    expect(Object.values(selectionSnapshot(node).marks).every((on) => on === false)).toBe(true);

    const gap = EditorState.create({ schema, doc, selection: new GapCursor(doc.resolve(doc.content.size)) });
    expect(selectionSnapshot(gap)).toMatchObject({ kind: 'gap', empty: true });
  });

  test('a selection inside a code block reports kind "code" — no inline mark applies there', () => {
    const doc = fromMarkdown('```\nconst x = 1;\n```\n');
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2, 6) });
    expect(selectionSnapshot(state)).toMatchObject({ kind: 'code', empty: false });
  });
});

describe('createSelectionPlugin: the view half', () => {
  interface FakeEditorView {
    state: EditorState;
    coordsAtPos: (pos: number, side?: number) => { left: number; right: number; top: number; bottom: number };
  }

  function drive(plugin: Plugin, view: FakeEditorView, prev: EditorState): void {
    const pluginView = plugin.spec.view!(view as never);
    pluginView.update!(view as never, prev);
  }

  test('reports the snapshot plus the coordinates of both ends whenever the selection changes', () => {
    const reports: SelectionReport[] = [];
    const plugin = createSelectionPlugin({ onChange: (report) => reports.push(report) });
    const initial = stateOf('__bold__ plain', 1);
    const view: FakeEditorView = {
      state: initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 2, 4))),
      coordsAtPos: (pos) => ({ left: pos * 10, right: pos * 10 + 8, top: 100, bottom: 120 }),
    };

    drive(plugin, view, initial);

    const latest = reports.at(-1)!;
    expect(latest).toMatchObject({ from: 2, to: 4, empty: false, marks: { strong: true } });
    expect(latest.coords).toEqual({
      from: { left: 20, right: 28, top: 100, bottom: 120 },
      to: { left: 40, right: 48, top: 100, bottom: 120 },
    });
  });

  test('reports once on mount, so the toolbar knows the initial selection, and not again for a transaction that changed nothing it shows', () => {
    const reports: SelectionReport[] = [];
    const plugin = createSelectionPlugin({ onChange: (report) => reports.push(report) });
    const state = stateOf('plain text', 3);
    const view: FakeEditorView = {
      state,
      coordsAtPos: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    };

    const pluginView = plugin.spec.view!(view as never);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ from: 3, to: 3, empty: true });

    view.state = state.apply(state.tr.setMeta('unrelated', true));
    pluginView.update!(view as never, state);

    expect(reports).toHaveLength(1);
  });

  test('the plugin is part of the surface: buildEditorPlugins installs it with the supplied onChange', () => {
    const reports: SelectionReport[] = [];
    const plugins = buildEditorPlugins({ selection: { onChange: (report) => reports.push(report) } });
    const withView = plugins.filter((plugin) => plugin.spec.view !== undefined);
    // One of the plugins carrying a view is the selection reporter.
    const doc = fromMarkdown('plain text');
    const prev = EditorState.create({ schema, doc, plugins });
    const view: FakeEditorView = {
      state: prev.apply(prev.tr.setSelection(TextSelection.create(doc, 1, 6))),
      coordsAtPos: () => ({ left: 1, right: 2, top: 3, bottom: 4 }),
    };
    for (const plugin of withView) {
      const pluginView = plugin.spec.view!({ ...view, dom: { addEventListener() {}, removeEventListener() {} } } as never);
      pluginView.update?.(view as never, prev);
    }

    // The mount-time report already sees the range; the update, with
    // nothing changed since, adds no second report.
    expect(reports.map((report) => [report.from, report.to])).toEqual([[1, 6]]);
  });
});

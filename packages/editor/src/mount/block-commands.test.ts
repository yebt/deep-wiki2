import { describe, expect, test } from 'bun:test';
import { GapCursor } from 'prosemirror-gapcursor';
import { EditorState, NodeSelection, Selection, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { fromMarkdown } from '../from-markdown';
import { schema } from '../schema';
import { toMarkdown } from '../to-markdown';
import {
  BLOCK_COMMANDS_NOT_TURNABLE,
  deleteBlock,
  duplicateBlock,
  moveBlockDown,
  moveBlockUp,
  topLevelBlock,
  turnInto,
} from './block-commands';
import { EDITOR_KEY_BINDINGS } from './keymap';
import { buildEditorPlugins } from './plugins';

/**
 * The block "tunes" (move, delete, duplicate, turn into) as pure
 * ProseMirror commands. Every case ends the same way: the document the
 * command built serialises to the Markdown named, and re-opening that
 * Markdown rebuilds the identical document — GATE-2 in the save
 * direction, per command, so a tune that produced a construct the pinned
 * pipeline cannot spell fails here rather than at the user's save.
 */

const DOC = '# Title\n\nFirst ^abc123\n\n- one\n- two\n\n***\n';

function stateOf(markdown: string, selection?: (doc: EditorState['doc']) => EditorState['selection']): EditorState {
  const doc = fromMarkdown(markdown);
  return EditorState.create({ schema, doc, selection: selection?.(doc), plugins: buildEditorPlugins() as Plugin[] });
}

/** A caret inside the first occurrence of `text`. */
function caretIn(markdown: string, text: string): EditorState {
  return stateOf(markdown, (doc) => {
    let at: number | undefined;
    doc.descendants((node, pos) => {
      if (at !== undefined || !node.isText) return at === undefined;
      const offset = node.text!.indexOf(text);
      if (offset >= 0) at = pos + offset + 1;
      return false;
    });
    if (at === undefined) throw new Error(`caretIn: "${text}" is not in the document`);
    return TextSelection.create(doc, at);
  });
}

function run(command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean, state: EditorState): { applied: boolean; next: EditorState } {
  let next = state;
  let dispatched = false;
  const applied = command(state, (tr) => {
    dispatched = true;
    next = state.apply(tr);
  });
  // A ProseMirror Command's contract: `false` also means "dispatched nothing".
  expect(dispatched).toBe(applied);
  return { applied, next };
}

function expectRoundTrip(state: EditorState, markdown: string): void {
  expect(toMarkdown(state.doc)).toBe(markdown);
  expect(fromMarkdown(markdown).toJSON()).toEqual(state.doc.toJSON());
}

describe('topLevelBlock', () => {
  test('a caret inside a nested list item resolves to the whole list, at depth 1', () => {
    const state = caretIn(DOC, 'two');
    const block = topLevelBlock(state)!;
    expect(block.node.type.name).toBe('list');
    expect(state.doc.nodeAt(block.pos)).toBe(block.node);
  });

  test('a node selection of a top-level block resolves to that block', () => {
    const state = stateOf(DOC, (doc) => NodeSelection.create(doc, doc.content.size - 1));
    expect(topLevelBlock(state)!.node.type.name).toBe('thematicBreak');
  });

  test('a gap cursor sits between blocks and resolves to none', () => {
    const state = stateOf(DOC, (doc) => new GapCursor(doc.resolve(doc.content.size)));
    expect(topLevelBlock(state)).toBeNull();
  });
});

describe('moveBlockUp / moveBlockDown: the block moves with its anchor, and the caret moves with it', () => {
  test('moving the anchored paragraph up puts it above the heading, anchor intact', () => {
    const { applied, next } = run(moveBlockUp, caretIn(DOC, 'First'));
    expect(applied).toBe(true);
    expectRoundTrip(next, 'First ^abc123\n\n# Title\n\n- one\n- two\n\n***\n');
    // The caret is still inside "First" — now the first block.
    expect(next.selection.$from.parent.textContent).toBe('First');
  });

  test('moving the list down puts it below the divider', () => {
    const { applied, next } = run(moveBlockDown, caretIn(DOC, 'two'));
    expect(applied).toBe(true);
    expectRoundTrip(next, '# Title\n\nFirst ^abc123\n\n***\n\n- one\n- two\n');
    expect(next.selection.$from.parent.textContent).toBe('two');
  });

  test('a node-selected divider moved up stays node-selected', () => {
    const state = stateOf(DOC, (doc) => NodeSelection.create(doc, doc.content.size - 1));
    const { next } = run(moveBlockUp, state);
    expectRoundTrip(next, '# Title\n\nFirst ^abc123\n\n***\n\n- one\n- two\n');
    expect(next.selection).toBeInstanceOf(NodeSelection);
    expect((next.selection as NodeSelection).node.type.name).toBe('thematicBreak');
  });

  test('the first block cannot move up and the last cannot move down: false, nothing dispatched', () => {
    expect(run(moveBlockUp, caretIn(DOC, 'Title')).applied).toBe(false);
    const last = stateOf(DOC, (doc) => NodeSelection.create(doc, doc.content.size - 1));
    expect(run(moveBlockDown, last).applied).toBe(false);
  });

  test('Alt-ArrowUp and Alt-ArrowDown are bound to the two moves', () => {
    const up = run(EDITOR_KEY_BINDINGS['Alt-ArrowUp']!, caretIn(DOC, 'First'));
    expect(toMarkdown(up.next.doc)).toBe('First ^abc123\n\n# Title\n\n- one\n- two\n\n***\n');
    const down = run(EDITOR_KEY_BINDINGS['Alt-ArrowDown']!, caretIn(DOC, 'First'));
    expect(toMarkdown(down.next.doc)).toBe('# Title\n\n- one\n- two\n\nFirst ^abc123\n\n***\n');
  });

  test('moving up then down restores the exact document', () => {
    const start = caretIn(DOC, 'First');
    const { next } = run(moveBlockDown, run(moveBlockUp, start).next);
    expect(next.doc.toJSON()).toEqual(start.doc.toJSON());
  });
});

describe('deleteBlock', () => {
  test('removes the whole top-level block the caret is in', () => {
    const { applied, next } = run(deleteBlock, caretIn(DOC, 'two'));
    expect(applied).toBe(true);
    expectRoundTrip(next, '# Title\n\nFirst ^abc123\n\n***\n');
  });

  test('deleting the only block leaves the one empty paragraph an empty document is', () => {
    const { next } = run(deleteBlock, caretIn('Only\n', 'Only'));
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild!.type.name).toBe('paragraph');
    expectRoundTrip(next, '');
  });
});

describe('duplicateBlock: a copy directly below, WITHOUT the anchor', () => {
  test('an anchored paragraph duplicates as an unanchored one — two blocks with one id would be the tombstone-resurrection class', () => {
    const { applied, next } = run(duplicateBlock, caretIn(DOC, 'First'));
    expect(applied).toBe(true);
    expectRoundTrip(next, '# Title\n\nFirst ^abc123\n\nFirst\n\n- one\n- two\n\n***\n');
    expect(next.doc.child(1).attrs.blockAnchor).toBe('abc123');
    expect(next.doc.child(2).attrs.blockAnchor).toBeNull();
    // The caret lands in the copy.
    expect(next.selection.from).toBeGreaterThan(next.doc.child(1).nodeSize);
    expect(next.selection.$from.parent.textContent).toBe('First');
  });

  test('anchors nested inside the block are stripped too, not only the top-level one', () => {
    const md = '- one ^aaaaaa\n- two ^bbbbbb\n';
    const { next } = run(duplicateBlock, caretIn(md, 'one'));
    // Two adjacent lists: the pinned pipeline alternates the bullet of
    // the second (`*`) so they stay two lists, and that spelling is
    // canonical — it re-opens as the same two lists.
    expectRoundTrip(next, '- one ^aaaaaa\n- two ^bbbbbb\n\n* one\n* two\n');
  });

  // The duplicate is the one tune that creates ADJACENT siblings of the
  // same type, which is where a serialiser has to choose a spelling:
  // adjacent lists alternate their marker, adjacent quotes need the
  // blank line to stay two quotes. Each block type this schema models,
  // duplicated, must come back as the same document.
  const DUPLICATES = [
    ['1. a\n2. b\n', '1. a\n2. b\n\n1) a\n2) b\n'],
    ['- [ ] task\n', '- [ ] task\n\n* [ ] task\n'],
    ['> quote\n', '> quote\n\n> quote\n'],
    ['```js\ncode\n```\n', '```js\ncode\n```\n\n```js\ncode\n```\n'],
    ['| a |\n| - |\n| 1 |\n', '| a |\n| - |\n| 1 |\n\n| a |\n| - |\n| 1 |\n'],
    ['Text[^1]\n\n[^1]: note\n', 'Text[^1]\n\nText[^1]\n\n[^1]: note\n'],
    ['- a\n\n  para\n', '- a\n\n  para\n\n* a\n\n  para\n'],
  ] as const;
  for (const [markdown, duplicated] of DUPLICATES) {
    test(`duplicating the first block of ${JSON.stringify(markdown)} re-opens identically`, () => {
      const state = stateOf(markdown, (doc) => Selection.near(doc.resolve(1)));
      const { applied, next } = run(duplicateBlock, state);
      expect(applied).toBe(true);
      expectRoundTrip(next, duplicated);
    });
  }

  test('a node-selected divider duplicates', () => {
    const state = stateOf(DOC, (doc) => NodeSelection.create(doc, doc.content.size - 1));
    const { next } = run(duplicateBlock, state);
    expectRoundTrip(next, '# Title\n\nFirst ^abc123\n\n- one\n- two\n\n***\n\n***\n');
  });
});

describe('turnInto: the slash commands, applied to the current block', () => {
  test('a paragraph becomes a heading through the same command the / menu runs', () => {
    const { applied, next } = run(turnInto('heading-2'), caretIn(DOC, 'First'));
    expect(applied).toBe(true);
    expectRoundTrip(next, '# Title\n\n## First ^abc123\n\n- one\n- two\n\n***\n');
  });

  test('a heading becomes a quote', () => {
    const { next } = run(turnInto('quote'), caretIn(DOC, 'Title'));
    expectRoundTrip(next, '> # Title\n\nFirst ^abc123\n\n- one\n- two\n\n***\n');
  });

  test('is refused on the blocks that carry raw source or cell structure: table, footnoteDefinition, verbatim', () => {
    expect(BLOCK_COMMANDS_NOT_TURNABLE).toEqual(['table', 'footnoteDefinition', 'verbatim']);

    const table = caretIn('| a | b |\n| - | - |\n| 1 | 2 |\n', '1');
    expect(run(turnInto('heading-1'), table).applied).toBe(false);

    const footnote = caretIn('Text[^1]\n\n[^1]: The note.\n', 'The note');
    expect(run(turnInto('heading-1'), footnote).applied).toBe(false);

    const verbatim = stateOf('<div>raw</div>\n', (doc) => NodeSelection.create(doc, 0));
    expect(verbatim.doc.firstChild!.type.name).toBe('verbatim');
    expect(run(turnInto('heading-1'), verbatim).applied).toBe(false);
  });

  test('an unknown command id is refused, not thrown', () => {
    expect(run(turnInto('no-such-command'), caretIn(DOC, 'First')).applied).toBe(false);
  });
});

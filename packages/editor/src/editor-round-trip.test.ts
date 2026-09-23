import { toggleMark } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, test } from 'bun:test';
import { fromMarkdown } from './from-markdown';
import { EDITOR_KEY_BINDINGS, buildHistory, buildKeymap } from './mount/keymap';
import { probe } from './probe';
import { schema } from './schema';
import { toMarkdown } from './to-markdown';

/**
 * GATE-2b — the other direction, over the other producer.
 *
 * `round-trip.test.ts` runs `md -> doc -> md` over a fixture corpus, and
 * every one of those fixtures was produced by the **parser**. That proves
 * the bytes survive a path no user takes. The only producer a real save
 * ever has is the **editor**: a document assembled by applying
 * `toggleMark` to a selection is a mark-set shape `parse()` never emits,
 * because a ProseMirror mark set is sorted by declaration rank and carries
 * no memory of which of two overlapping marks was written outermost.
 *
 * So this suite runs `doc -> md -> doc` over documents the editor built,
 * and it drives the real bindings (`EDITOR_KEY_BINDINGS`, the exact record
 * `createEditorView` installs) rather than hand-constructing nodes — a
 * hand-built node is a guess about what the editor produces, and the
 * defect this suite exists for lives precisely in that gap.
 *
 * Each case asserts four things, because three of them can pass while the
 * user's file is still destroyed:
 *
 *   1. the saved bytes are the canonical spelling of what the user did;
 *   2. `probe()` re-opens those bytes — a page that saves and can never be
 *      edited again is the worst outcome available here;
 *   3. re-parsing the saved bytes yields the *same document*, so the next
 *      edit starts where this one ended;
 *   4. a second save is a fixed point, so repeated passes cannot accrete
 *      delimiters.
 */

/** Opens `markdown` in the same state shape `createEditorView` builds: the real schema, the real keymap, the real history. */
function open(markdown: string): EditorState {
  return EditorState.create({
    schema,
    doc: fromMarkdown(markdown),
    plugins: [buildKeymap(), buildHistory()],
  });
}

/** Selects the first occurrence of `text` inside a single text node, the way a user double-clicking a word does. */
function select(state: EditorState, text: string): EditorState {
  let from: number | undefined;
  state.doc.descendants((node, pos) => {
    if (from !== undefined || !node.isText) return true;
    const offset = (node.text ?? '').indexOf(text);
    if (offset >= 0) from = pos + offset;
    return true;
  });
  if (from === undefined) throw new Error(`select: "${text}" is not in the document`);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + text.length)));
}

/** Selects a single-paragraph document end to end, the way `Mod-a` then `Mod-b` does. */
function selectAll(state: EditorState): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
}

/** Runs whatever `key` is really bound to in the editing surface. Not a stand-in command: the binding record itself. */
function press(state: EditorState, key: string): EditorState {
  const command = EDITOR_KEY_BINDINGS[key];
  if (!command) throw new Error(`press: nothing is bound to ${key}`);
  let next: EditorState | undefined;
  const handled = command(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  if (!handled || !next) throw new Error(`press: ${key} did not apply`);
  return next;
}

/** Puts the caret at the end of the first text node containing `text`, the way clicking past a line's last character does. */
function caretAfter(state: EditorState, text: string): EditorState {
  let at: number | undefined;
  state.doc.descendants((node, pos) => {
    if (at !== undefined || !node.isText) return true;
    const offset = (node.text ?? '').indexOf(text);
    if (offset >= 0) at = pos + offset + text.length;
    return true;
  });
  if (at === undefined) throw new Error(`caretAfter: "${text}" is not in the document`);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** Types `text` at the caret, the way a person continuing a line does. */
function type(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text));
}

/** `delete` has no key binding and no input rule; it only ever arrives from a parsed document, so a case that needs one applies the same `toggleMark` command factory the bindings use. */
function strike(state: EditorState): EditorState {
  let next: EditorState | undefined;
  toggleMark(schema.marks.delete!)(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  if (!next) throw new Error('strike: toggleMark(delete) did not apply');
  return next;
}

interface Case {
  readonly name: string;
  readonly opens: string;
  readonly edit: (state: EditorState) => EditorState;
  readonly saves: string;
}

const CASES: readonly Case[] = [
  {
    name: 'bolding a word inside emphasis',
    opens: '_x y z_\n',
    edit: (state) => press(select(state, 'y'), 'Mod-b'),
    saves: '_x __y__ z_\n',
  },
  {
    name: 'bolding a word inside a strikethrough',
    opens: '~~x y z~~\n',
    edit: (state) => press(select(state, 'y'), 'Mod-b'),
    saves: '~~x __y__ z~~\n',
  },
  {
    name: 'italicising a word inside strong',
    opens: '__x y z__\n',
    edit: (state) => press(select(state, 'y'), 'Mod-i'),
    saves: '__x _y_ z__\n',
  },
  {
    name: 'bolding a word inside a link',
    opens: '[x y z](/a)\n',
    edit: (state) => press(select(state, 'y'), 'Mod-b'),
    saves: '[x __y__ z](/a)\n',
  },
  {
    name: 'striking a word inside emphasis',
    opens: '_x y z_\n',
    edit: (state) => strike(select(state, 'y')),
    saves: '_x ~~y~~ z_\n',
  },
  {
    name: 'bolding a whole paragraph, then italicising one word inside it',
    opens: 'x y z\n',
    edit: (state) => press(select(press(select(state, 'x y z'), 'Mod-b'), 'y'), 'Mod-i'),
    saves: '__x _y_ z__\n',
  },
  {
    name: 'bolding a word inside emphasis inside a list item',
    opens: '- _x y z_\n',
    edit: (state) => press(select(state, 'y'), 'Mod-b'),
    saves: '- _x __y__ z_\n',
  },
  {
    name: 'bolding a word inside emphasis in a heading',
    opens: '# _x y z_\n',
    edit: (state) => press(select(state, 'y'), 'Mod-b'),
    saves: '# _x __y__ z_\n',
  },
  // An inline ATOM carries marks too — `addMark` puts `strong` on a
  // `wikiLink`/`tag`/`break`/`verbatimInline` node the same way it puts it
  // on a text node, so a mark run that contains one is one run, not three.
  {
    name: 'bolding a line that contains a wiki-link',
    opens: 'a [[Page]] b\n',
    edit: (state) => press(selectAll(state), 'Mod-b'),
    saves: '__a [[Page]] b__\n',
  },
  {
    name: 'bolding a line that contains a tag',
    opens: 'a #tag b\n',
    edit: (state) => press(selectAll(state), 'Mod-b'),
    saves: '__a #tag b__\n',
  },
  {
    name: 'bolding a line that contains an inline image',
    opens: 'a ![i](/i.png) b\n',
    edit: (state) => press(selectAll(state), 'Mod-b'),
    saves: '__a ![i](/i.png) b__\n',
  },
  {
    name: 'bolding across a hard line break',
    opens: 'a\\\nb\n',
    edit: (state) => press(selectAll(state), 'Mod-b'),
    saves: '__a\\\nb__\n',
  },
  // GFM task items (the owner's 2026-09-23 report). Ticking a box is an
  // attribute change on a `listItem`, which is exactly the kind of edit no
  // parsed fixture can produce — `modelled/task-list.md` proves the bytes
  // survive a parse, and proved nothing about an edit.
  {
    name: 'ticking a task item',
    opens: '- [ ] not done yet\n',
    edit: (state) => press(select(state, 'not'), 'Mod-Enter'),
    saves: '- [x] not done yet\n',
  },
  {
    name: 'unticking a task item',
    opens: '- [x] already done\n',
    edit: (state) => press(select(state, 'already'), 'Mod-Enter'),
    saves: '- [ ] already done\n',
  },
  {
    name: 'ticking a nested task item, leaving its parent alone',
    opens: '- [ ] outer\n  - [ ] inner\n',
    edit: (state) => press(select(state, 'inner'), 'Mod-Enter'),
    saves: '- [ ] outer\n  - [x] inner\n',
  },
  {
    name: 'continuing a checklist after a done item',
    opens: '- [x] done\n',
    edit: (state) => type(press(caretAfter(state, 'done'), 'Enter'), 'next'),
    saves: '- [x] done\n- [ ] next\n',
  },
  {
    name: 'continuing a checklist after an item that is not done',
    opens: '- [ ] first\n',
    edit: (state) => type(press(caretAfter(state, 'first'), 'Enter'), 'second'),
    saves: '- [ ] first\n- [ ] second\n',
  },
];

describe('GATE-2b [editor-built byte identity]: what the editor saves is the canonical spelling of the edit', () => {
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const edited = testCase.edit(open(testCase.opens));

      expect(toMarkdown(edited.doc)).toBe(testCase.saves);
    });
  }
});

describe('GATE-2b [editor-built byte identity]: the editor never invents a character reference', () => {
  // `&#x20;` is what `mdast-util-to-markdown` emits when a wrapper it was
  // handed ends in a space that its own delimiter run cannot survive. That
  // entity in the output is proof the tree handed to it was wrong, not
  // proof the escaping was clever: no edit in this suite types one.
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const saved = toMarkdown(testCase.edit(open(testCase.opens)).doc);

      expect(saved).not.toContain('&#x');
    });
  }
});

describe('GATE-2b [doc -> md -> doc]: an editor-built document re-opens as the same document', () => {
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const edited = testCase.edit(open(testCase.opens));
      const saved = toMarkdown(edited.doc);

      // Not `toEqual` on the JSON: `Node.eq` is ProseMirror's own identity,
      // marks and attributes included.
      const reopened: PMNode = fromMarkdown(saved);
      expect(reopened.eq(edited.doc)).toBe(true);
    });
  }
});

describe('GATE-2b [probe accept]: a page the editor just saved can be edited again', () => {
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const saved = toMarkdown(testCase.edit(open(testCase.opens)).doc);

      expect(probe(saved)).toEqual({ ok: true });
    });
  }
});

describe('GATE-2b [invariant]: a second save is a fixed point, so passes cannot accrete delimiters', () => {
  for (const testCase of CASES) {
    test(testCase.name, () => {
      const saved = toMarkdown(testCase.edit(open(testCase.opens)).doc);

      expect(toMarkdown(fromMarkdown(saved))).toBe(saved);
    });
  }
});

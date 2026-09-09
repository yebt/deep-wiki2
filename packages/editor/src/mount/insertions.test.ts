import { describe, expect, test } from 'bun:test';
import { history, undo } from 'prosemirror-history';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { schema } from '../schema';
import { toMarkdown } from '../to-markdown';
import { createMentionPlugin, insertMention, type MentionCandidate } from './mention-plugin';
import { confirmSlashCommand, createSlashPlugin, SLASH_COMMANDS, slashPluginKey, type SlashCommand } from './slash-plugin';

/**
 * The three mutations `packages/editor` actually performs on the document
 * — the eight slash commands' `run`, `insertMention`, and the undo
 * grouping both of them promise — exercised against a real
 * `EditorState` built on this project's own schema, and checked by what
 * they serialise back to (`toMarkdown`), not only by node names.
 *
 * No DOM. `createEditorView` needs one; the plugins do not: their
 * `handleKeyDown` props only ever touch `view.state` and `view.dispatch`,
 * so `fakeView` below is a faithful stand-in for `EditorView`'s default
 * `dispatchTransaction` (apply the transaction, keep the new state) and
 * drives the exact production code path a keypress does.
 */

interface FakeView {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}

function fakeView(state: EditorState): FakeView {
  const view: FakeView = {
    state,
    dispatch(tr) {
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

function press(view: FakeView, key: string, plugin: { props?: { handleKeyDown?: unknown } }): boolean {
  const handler = plugin.props?.handleKeyDown as
    | ((view: unknown, event: { key: string }) => boolean)
    | undefined;
  if (!handler) throw new Error('plugin has no handleKeyDown');
  return handler(view, { key });
}

/** A one-paragraph document with the cursor at the end of `text`. */
function paragraphState(text: string, plugins: readonly unknown[] = []): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', { blockAnchor: null }, text ? schema.text(text) : undefined),
  ]);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, text.length + 1),
    plugins: plugins as never,
  });
}

/**
 * A one-cell table with the cursor at the end of `text` inside the cell.
 * `tableCell` is `inline*` (schema.ts), so it can hold no block at all —
 * the one reachable place in this schema where every slash command is
 * inapplicable, and `trigger.ts`'s `isInsideCodeBlock` does not keep the
 * menu out of it.
 */
function tableCellState(text: string, plugins: readonly unknown[] = []): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('table', { blockAnchor: null }, [
      schema.node('tableRow', null, [
        schema.node('tableCell', { align: null }, text ? schema.text(text) : undefined),
      ]),
    ]),
  ]);
  // doc > table(1) > tableRow(2) > tableCell(3): the cell's text starts at 3.
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, text.length + 3),
    plugins: plugins as never,
  });
}

function commandById(id: string): SlashCommand {
  const command = SLASH_COMMANDS.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`no slash command "${id}"`);
  return command;
}

/** Runs one slash command against `state`, asserting it reported that it applied, and returns the resulting state. */
function applyCommand(id: string, state: EditorState): EditorState {
  let next = state;
  const applied = commandById(id).run(state, (tr) => {
    next = state.apply(tr);
  });
  expect(applied).toBe(true);
  return next;
}

// document-editor: the slash menu's commands are block transforms. Each
// case names the Markdown the command promises, so a command that quietly
// produces a different construct (or none) fails here rather than being
// "verified" by an id/label comparison.
const SLASH_EXPECTATIONS: ReadonlyArray<{
  readonly id: string;
  readonly topLevelType: string;
  readonly markdown: string;
}> = [
  { id: 'heading-1', topLevelType: 'heading', markdown: '# Section title\n' },
  { id: 'heading-2', topLevelType: 'heading', markdown: '## Section title\n' },
  { id: 'heading-3', topLevelType: 'heading', markdown: '### Section title\n' },
  { id: 'bullet-list', topLevelType: 'list', markdown: '- Section title\n' },
  { id: 'numbered-list', topLevelType: 'list', markdown: '1. Section title\n' },
  { id: 'quote', topLevelType: 'blockquote', markdown: '> Section title\n' },
  { id: 'code-block', topLevelType: 'code', markdown: '```\nSection title\n```\n' },
];

describe('SLASH_COMMANDS: every command runs and produces the construct it promises', () => {
  test('the expectation table covers every declared command', () => {
    const covered = new Set([...SLASH_EXPECTATIONS.map((e) => e.id), 'divider']);
    expect(SLASH_COMMANDS.map((command) => command.id).filter((id) => !covered.has(id))).toEqual([]);
  });

  for (const { id, topLevelType, markdown } of SLASH_EXPECTATIONS) {
    test(`${id} rewrites the current block and serialises to ${JSON.stringify(markdown)}`, () => {
      const next = applyCommand(id, paragraphState('Section title'));

      expect(next.doc.firstChild!.type.name).toBe(topLevelType);
      expect(next.doc.childCount).toBe(1);
      expect(toMarkdown(next.doc)).toBe(markdown);
    });
  }

  test('heading-1/2/3 set the level they name, not just "a heading"', () => {
    for (const [id, level] of [
      ['heading-1', 1],
      ['heading-2', 2],
      ['heading-3', 3],
    ] as const) {
      expect(applyCommand(id, paragraphState('Section title')).doc.firstChild!.attrs.level).toBe(level);
    }
  });

  test('bullet-list and numbered-list differ in the list they build, not only in their label', () => {
    expect(applyCommand('bullet-list', paragraphState('Section title')).doc.firstChild!.attrs.ordered).toBe(false);
    const ordered = applyCommand('numbered-list', paragraphState('Section title')).doc.firstChild!;
    expect(ordered.attrs.ordered).toBe(true);
    expect(ordered.attrs.start).toBe(1);
  });

  test('divider inserts a thematicBreak that serialises to the pinned rule spelling', () => {
    const next = applyCommand('divider', paragraphState(''));

    expect(next.doc.content.content.some((node) => node.type.name === 'thematicBreak')).toBe(true);
    expect(toMarkdown(next.doc)).toBe('***\n');
  });
});

// document-editor: a command that cannot run at the caret must never
// consume what the user typed. `tableCell` is `inline*`, so all eight
// commands are inapplicable there — and the menu opened there anyway,
// deleted the trigger text, transformed nothing, and swallowed the key.
describe('a slash command that cannot apply consumes nothing', () => {
  for (const command of SLASH_COMMANDS) {
    test(`${command.id} confirmed inside a table cell leaves the document exactly as it was`, () => {
      const state = tableCellState('/x');
      const before = state.doc.toJSON();

      const tr = confirmSlashCommand(state, command, { from: 3, to: 5 });
      const next = tr ? state.apply(tr) : state;

      expect(next.doc.textContent).toBe('/x');
      expect(next.doc.toJSON()).toEqual(before);
    });
  }

  test('every command reports inapplicability when run without a dispatch, as a ProseMirror Command must', () => {
    const state = tableCellState('/x');
    expect(SLASH_COMMANDS.filter((command) => command.run(state)).map((c) => c.id)).toEqual([]);
  });

  test('divider does not escape the table it cannot be placed in', () => {
    // `replaceSelectionWith` escalates depth to fit the slice, so an
    // unchecked divider dropped a thematicBreak AFTER the whole table.
    const state = tableCellState('/x');
    const tr = confirmSlashCommand(state, commandById('divider'), { from: 3, to: 5 });
    const next = tr ? state.apply(tr) : state;

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild!.type.name).toBe('table');
    expect(toMarkdown(next.doc)).toBe(toMarkdown(state.doc));
  });

  test('the menu offers nothing inside a table cell — an offer it cannot honour is not an offer', () => {
    const plugin = createSlashPlugin();
    const view = fakeView(tableCellState('/', [plugin]));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));

    const slash = slashPluginKey.getState(view.state)!;
    expect(slash.active).toBe(true);
    expect(slash.commands).toEqual([]);
  });

  test('Enter inside a table cell changes nothing at all', () => {
    const plugin = createSlashPlugin();
    const view = fakeView(tableCellState('/quote', [plugin]));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)));
    expect(slashPluginKey.getState(view.state)!.active).toBe(true);
    const before = view.state.doc.toJSON();

    expect(press(view, 'Enter', plugin)).toBe(true);

    expect(view.state.doc.toJSON()).toEqual(before);
  });

  test('a paragraph still offers all eight, so the filter narrows nothing it should not', () => {
    const plugin = createSlashPlugin();
    const view = fakeView(paragraphState('/', [plugin]));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));

    expect(slashPluginKey.getState(view.state)!.commands.map((c) => c.id)).toEqual(
      SLASH_COMMANDS.map((c) => c.id),
    );
  });
});

describe('the slash menu confirms into the real command, not only into a state change', () => {
  test('Enter on "/quote" removes the trigger text and applies the quote command', () => {
    const plugin = createSlashPlugin();
    const view = fakeView(paragraphState('/quote', [history(), plugin]));

    expect(slashPluginKey.getState(view.state)).toBeDefined();
    // The plugin's appendTransaction only sees a transaction; seed one so
    // the trigger is detected exactly as typing would.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));
    expect(slashPluginKey.getState(view.state)!.active).toBe(true);

    expect(press(view, 'Enter', plugin)).toBe(true);

    expect(view.state.doc.firstChild!.type.name).toBe('blockquote');
    expect(toMarkdown(view.state.doc)).toBe('>\n');
    expect(slashPluginKey.getState(view.state)!.active).toBe(false);
  });
});

const PAGE_CANDIDATE: MentionCandidate = { id: 'page-01', type: 'page', label: 'Getting Started' };
const USER_CANDIDATE: MentionCandidate = { id: 'user-01', type: 'user', label: 'Ada' };

describe('insertMention', () => {
  test('a page candidate replaces the trigger text with a real wikiLink node carrying its attributes', () => {
    const state = paragraphState('See @Gett');
    // "See " is 4 characters, so the "@" sits at document position 5.
    const next = state.apply(insertMention(PAGE_CANDIDATE, { from: 5, to: 10 }, state.tr));

    const paragraph = next.doc.firstChild!;
    expect(paragraph.childCount).toBe(2);
    expect(paragraph.child(0).text).toBe('See ');

    const mention = paragraph.child(1);
    expect(mention.type.name).toBe('wikiLink');
    expect(mention.attrs).toEqual({
      raw: '[[Getting Started]]',
      target: 'page-01',
      anchor: null,
      alias: 'Getting Started',
    });
  });

  test('a user candidate replaces the trigger text with plain "@Label " text and no node', () => {
    const state = paragraphState('Ping @Ad');
    const next = state.apply(insertMention(USER_CANDIDATE, { from: 6, to: 9 }, state.tr));

    expect(next.doc.textContent).toBe('Ping @Ada ');
    expect(next.doc.firstChild!.content.content.every((node) => node.isText)).toBe(true);
  });

  test('nothing of the trigger text survives — the "@" and the partial query are both gone', () => {
    const state = paragraphState('See @Gett');
    const next = state.apply(insertMention(PAGE_CANDIDATE, { from: 5, to: 10 }, state.tr));

    expect(next.doc.textContent).not.toContain('@');
    expect(next.doc.textContent).not.toContain('Gett');
  });

  test('the inserted page mention serialises back to the wiki-link Markdown it carries', () => {
    const state = paragraphState('See @Gett');
    const next = state.apply(insertMention(PAGE_CANDIDATE, { from: 5, to: 10 }, state.tr));

    expect(toMarkdown(next.doc)).toBe('See [[Getting Started]]\n');
  });
});

// document-editor: "Mention And Slash Insertions Undo As One Step". Until
// now this was argued in a source comment about prosemirror-history's
// 500ms grouping window and asserted nowhere.
describe('mention and slash insertions undo as ONE step', () => {
  test('a confirmed page mention is removed by a single undo', () => {
    const before = paragraphState('See @Gett', [history()]);
    const view = fakeView(before);
    view.dispatch(insertMention(PAGE_CANDIDATE, { from: 5, to: 10 }, view.state.tr));
    expect(toMarkdown(view.state.doc)).toBe('See [[Getting Started]]\n');

    const undone = undo(view.state, view.dispatch);

    expect(undone).toBe(true);
    expect(view.state.doc.toJSON()).toEqual(before.doc.toJSON());
    // And there is nothing left to undo: the insertion was one step, not two.
    expect(undo(view.state, view.dispatch)).toBe(false);
  });

  test('a slash command confirmed with Enter — two dispatches — is removed by a single undo', () => {
    const plugin = createSlashPlugin();
    const before = paragraphState('/quote', [history(), plugin]);
    const view = fakeView(before);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));
    expect(slashPluginKey.getState(view.state)!.active).toBe(true);

    press(view, 'Enter', plugin);
    expect(view.state.doc.firstChild!.type.name).toBe('blockquote');

    const undone = undo(view.state, view.dispatch);

    expect(undone).toBe(true);
    expect(view.state.doc.toJSON()).toEqual(before.doc.toJSON());
    expect(undo(view.state, view.dispatch)).toBe(false);
  });

  test('a mention confirmed through the plugin keymap undoes as one step too', () => {
    const plugin = createMentionPlugin({ onConfirm: insertMention });
    const before = paragraphState('See @Gett', [history(), plugin]);
    const view = fakeView(before);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 10)));
    view.dispatch(
      view.state.tr.setMeta(plugin.spec.key!, { type: 'setCandidates', candidates: [PAGE_CANDIDATE] }),
    );

    press(view, 'Enter', plugin);
    expect(toMarkdown(view.state.doc)).toBe('See [[Getting Started]]\n');

    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.toJSON()).toEqual(before.doc.toJSON());
    expect(undo(view.state, view.dispatch)).toBe(false);
  });
});

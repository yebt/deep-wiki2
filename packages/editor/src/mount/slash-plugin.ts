/**
 * The `/` slash command menu (document-editor spec: same keyboard-first
 * contract as `@` mentions, empty/no-results states, inert inside a code
 * block). Candidates are a fixed, local list of block-transform commands
 * — no network round trip, unlike mentions — so filtering is synchronous
 * and the reducer never needs a `setCandidates` action.
 */
import { lift, wrapIn } from 'prosemirror-commands';
import type { Attrs, Node as PMNode, NodeType, ResolvedPos } from 'prosemirror-model';
import { type Command, EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { schema } from '../schema';
import type { SlashCommandSummary, SlashState } from '../types';
import { moveSelection } from './mention-plugin';
import { isInsideCodeBlock, matchTrigger } from './trigger';

export type { SlashCommandSummary, SlashState };

/**
 * The runnable command, kept internal to `packages/editor` — `run`
 * closes over `prosemirror-state`/`-commands` types, so it can never be
 * part of `SlashCommandSummary` (the shape `"."` re-exports for
 * apps/web's type-only needs). `SlashState.commands` only ever holds the
 * summary; `handleKeyDown`'s Enter case looks the full command back up by
 * id from `SLASH_COMMANDS` at confirm time.
 */
export interface SlashCommand extends SlashCommandSummary {
  /**
   * A ProseMirror `Command`, with its contract intact: `dispatch` is
   * OPTIONAL, and calling `run(state)` with none is a dry run that
   * answers "could this apply here?" without touching the document.
   * `false` means it cannot, and — this is the part that was missing —
   * `false` also means it did not call `dispatch`.
   */
  readonly run: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
}

/**
 * True when `type` can be placed at the caret WITHOUT ProseMirror moving
 * it somewhere else.
 *
 * `Transform.replaceRange` (which is what `replaceSelectionWith` reaches)
 * escalates depth until the slice fits, so an unchecked insertion inside a
 * `tableCell` — `inline*`, so it can hold no block at all — does not fail.
 * It walks out of the whole table and drops the node after it, leaving the
 * user's text where it was and a horizontal rule somewhere they never put
 * the caret. Only the caret's own container is asked here, never its
 * ancestors: that is precisely the difference from
 * prosemirror-example-setup's `canInsert`, which walks up and would call
 * the escalated placement legal.
 */
function canInsertAtCaret(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  const depth = Math.max($from.depth - 1, 0);
  const index = $from.index(depth);
  return $from.node(depth).canReplaceWith(index, index, type);
}

/**
 * `prosemirror-commands`' `setBlockType`, with one difference: the block's
 * `blockAnchor` survives. That command replaces a block's attrs wholesale,
 * so `/heading` on `First ^abc123` produced `# First` — the anchor, with
 * every comment and citation hanging from it, silently gone. A retyped
 * block is the same block. Built on `Transform.setBlockType`'s
 * per-node attrs callback, which `prosemirror-commands` (1.7) does not
 * yet expose; the applicability check is the original's, unchanged.
 */
export function setBlockTypeKeepingAnchor(type: NodeType, attrs: Attrs | null = null): Command {
  const keepsAnchor = 'blockAnchor' in type.spec.attrs!;
  const attrsFor = (node: { readonly attrs: Attrs }): Attrs =>
    keepsAnchor ? { ...attrs, blockAnchor: node.attrs.blockAnchor ?? null } : { ...attrs };
  return (state, dispatch) => {
    let applicable = false;
    for (const { $from, $to } of state.selection.ranges) {
      state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (applicable) return false;
        if (!node.isTextblock || node.hasMarkup(type, attrsFor(node))) return;
        if (node.type === type) {
          applicable = true;
        } else {
          const $pos = state.doc.resolve(pos);
          const index = $pos.index();
          applicable = $pos.parent.canReplaceWith(index, index + 1, type);
        }
        return;
      });
      if (applicable) break;
    }
    if (!applicable) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { $from, $to } of state.selection.ranges) tr.setBlockType($from.pos, $to.pos, type, attrsFor);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function typeOf(name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) throw new Error(`slash command references unknown node type "${name}"`);
  return type;
}

/** The depth of the nearest `listItem` ancestor of `$pos`, or `null`. */
function listItemDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth >= 1; depth--) if ($pos.node(depth).type === typeOf('listItem')) return depth;
  return null;
}

/**
 * "Text": the way back to a plain paragraph, which is what every other
 * command here starts from. A heading or code block is retyped in place
 * (anchor kept); a list item is lifted out of its list, and a quoted
 * paragraph out of its quote — one level, the same step `Shift-Tab`
 * takes. A top-level paragraph is already text, so the command is
 * inapplicable there and the menu does not offer it.
 */
const textCommand: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const paragraph = typeOf('paragraph');
  if ($from.parent.isTextblock && $from.parent.type !== paragraph && $from.parent.type !== typeOf('tableCell')) {
    return setBlockTypeKeepingAnchor(paragraph)(state, dispatch);
  }
  if ($from.depth >= 2 && $from.node($from.depth - 1).type === typeOf('listItem')) return liftListItem(typeOf('listItem'))(state, dispatch);
  if ($from.depth >= 2 && $from.node($from.depth - 1).type === typeOf('blockquote')) return lift(state, dispatch);
  return false;
};

/**
 * A task list: the current block wrapped in a bullet list whose item is
 * `checked: false` (GFM `- [ ]`), or — inside an existing bullet item —
 * that item made a task in place, rather than a list nested in a list.
 * An item that is already a task is left alone.
 */
const taskListCommand: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const itemDepth = listItemDepth($from);
  if (itemDepth !== null) {
    const item = $from.node(itemDepth);
    if (item.attrs.checked !== null) return false;
    dispatch?.(state.tr.setNodeMarkup($from.before(itemDepth), undefined, { ...item.attrs, checked: false }));
    return true;
  }
  return wrapInList(typeOf('list'), { ordered: false })(
    state,
    dispatch &&
      ((tr) => {
        const depth = listItemDepth(tr.selection.$from);
        if (depth !== null) {
          const item = tr.selection.$from.node(depth);
          tr.setNodeMarkup(tr.selection.$from.before(depth), undefined, { ...item.attrs, checked: false });
        }
        dispatch(tr);
      }),
  );
};

/**
 * A 2x2 table with empty cells. The empty spelling is canonical —
 * `|   |   |` / `| - | - |` / `|   |   |`, fixture `table-empty.md` —
 * so no placeholder text is needed. The caret lands in the first cell.
 * Placement is `divider`'s: only where the caret's own container can
 * hold a block (see `canInsertAtCaret`).
 */
const tableCommand: Command = (state, dispatch) => {
  const type = typeOf('table');
  if (!canInsertAtCaret(state, type)) return false;
  if (dispatch) {
    const cell = (): PMNode => typeOf('tableCell').create({ align: null });
    const row = (): PMNode => typeOf('tableRow').create(null, [cell(), cell()]);
    const table = type.create({ blockAnchor: null }, [row(), row()]);
    const tr = state.tr.replaceSelectionWith(table);
    let tablePos: number | null = null;
    tr.doc.descendants((node, pos) => {
      if (node === table) tablePos = pos;
      return tablePos === null;
    });
    // table(+1) > tableRow(+1) > tableCell(+1): the first cell's content.
    if (tablePos !== null) tr.setSelection(TextSelection.create(tr.doc, tablePos + 3));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** The first positive integer no `footnoteDefinition` or `footnoteReference` in `doc` already uses. */
function nextFootnoteIdentifier(doc: PMNode): string {
  const used = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'footnoteDefinition' || node.type.name === 'footnoteReference') used.add(node.attrs.identifier as string);
    return true;
  });
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/**
 * A footnote: `[^n]` at the caret and an empty `[^n]:` definition at the
 * end of the document, with the caret moved into the definition so the
 * user types the note next. The empty definition is canonical
 * (`empty-containers.md`) — no placeholder text to delete. The reference
 * is inline, so this is the one command a table cell can run.
 */
const footnoteCommand: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const reference = typeOf('footnoteReference');
  const index = $from.index();
  if (!$from.parent.canReplaceWith(index, index, reference)) return false;
  if (dispatch) {
    const identifier = nextFootnoteIdentifier(state.doc);
    const tr = state.tr.replaceSelectionWith(reference.create({ identifier }), false);
    const definition = typeOf('footnoteDefinition').create({ identifier, blockAnchor: null }, [typeOf('paragraph').create()]);
    tr.insert(tr.doc.content.size, definition);
    // doc end(-0) > definition close(-1) > paragraph close(-2): inside the empty paragraph.
    tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'text', label: 'Text', description: 'Plain paragraph', run: textCommand },
  { id: 'heading-1', label: 'Heading 1', description: 'Big section heading', run: (s, d) => setBlockTypeKeepingAnchor(typeOf('heading'), { level: 1 })(s, d) },
  { id: 'heading-2', label: 'Heading 2', description: 'Medium section heading', run: (s, d) => setBlockTypeKeepingAnchor(typeOf('heading'), { level: 2 })(s, d) },
  { id: 'heading-3', label: 'Heading 3', description: 'Small section heading', run: (s, d) => setBlockTypeKeepingAnchor(typeOf('heading'), { level: 3 })(s, d) },
  { id: 'bullet-list', label: 'Bulleted list', description: 'A simple bulleted list', run: (s, d) => wrapInList(typeOf('list'), { ordered: false })(s, d) },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    description: 'A list with numbering',
    run: (s, d) => wrapInList(typeOf('list'), { ordered: true, start: 1 })(s, d),
  },
  { id: 'task-list', label: 'Task list', description: 'A list with checkboxes', run: taskListCommand },
  { id: 'quote', label: 'Quote', description: 'A blockquote', run: (s, d) => wrapIn(typeOf('blockquote'))(s, d) },
  // A code block keeps the attr too, but `to-markdown.ts` has no anchor
  // spelling for a fence, so it is dropped at serialisation — see the
  // `code` case there. The attr is preserved here so turning the fence
  // back into a paragraph within one session restores the anchor.
  { id: 'code-block', label: 'Code block', description: 'A fenced code block', run: (s, d) => setBlockTypeKeepingAnchor(typeOf('code'))(s, d) },
  {
    id: 'divider',
    label: 'Divider',
    description: 'A horizontal rule',
    run: (s, d) => {
      const type = typeOf('thematicBreak');
      if (!canInsertAtCaret(s, type)) return false;
      d?.(s.tr.replaceSelectionWith(type.create()));
      return true;
    },
  },
  { id: 'table', label: 'Table', description: 'A 2x2 table', run: tableCommand },
  { id: 'footnote', label: 'Footnote', description: 'A reference here and its note at the end', run: footnoteCommand },
];

/**
 * Builds the ONE transaction that confirming a slash command produces:
 * the trigger text (`/query`) removed AND the command applied, in a
 * single undoable step (document-editor: "Mention And Slash Insertions
 * Undo As One Step").
 *
 * It has to be one transaction, not two adjacent ones. The earlier
 * two-dispatch form relied on `prosemirror-history` grouping adjacent
 * transactions inside its 500ms window, but grouping ALSO requires the
 * second transaction's changed range to be adjacent to the first's
 * (`isAdjacentTo`), and a block transform is not: deleting `/quote`
 * leaves a changed range at the caret, while `wrapIn`/`setBlockType`
 * change the ranges at the block's two boundaries. History opened a new
 * group, and undo took two presses — restoring the paragraph but leaving
 * the `/quote` text deleted. Verified by
 * `mount/insertions.test.ts`.
 *
 * `setBlockType`/`wrapIn`/`wrapInList` are ProseMirror `Command`s: each
 * builds its own transaction from the state it is handed and cannot
 * append to one already in progress. So the command runs against a
 * plugin-free scratch state positioned on the post-delete document, and
 * its steps are replayed onto `tr` — they are already expressed in
 * exactly that document's coordinates, so no mapping is needed.
 *
 * Returns `null` when the command cannot apply at this selection, and the
 * caller must then dispatch nothing of this transaction. A `Command`
 * reports that by returning `false` *without* calling `dispatch`, and
 * discarding that return value is how `/quote` in a `tableCell` (which is
 * `inline*` and can host no block) deleted the six characters the user had
 * typed, transformed nothing, and reported the key as handled. The menu
 * no longer offers a command that cannot run here (`filterSlashCommands`),
 * so this is the second lock on the same door rather than the only one:
 * the applicability the menu computes is measured against the live
 * document, and this one against the post-delete document the command
 * will actually see.
 */
export function confirmSlashCommand(
  state: EditorState,
  command: SlashCommand,
  range: { readonly from: number; readonly to: number },
): Transaction | null {
  const tr = state.tr.delete(range.from, range.to).setMeta(slashPluginKey, { type: 'dismiss' } satisfies SlashAction);

  const scratch = EditorState.create({ schema: state.schema, doc: tr.doc, selection: tr.selection, plugins: [] });
  let dispatched = false;
  const applied = command.run(scratch, (commandTr) => {
    dispatched = true;
    for (const step of commandTr.steps) tr.step(step);
    if (commandTr.selectionSet) tr.setSelection(Selection.fromJSON(tr.doc, commandTr.selection.toJSON()));
  });

  // `applied` is the command's own verdict; `dispatched` is what actually
  // reached `tr`. Both are required, so a command that returns `true` and
  // dispatches nothing cannot smuggle a bare deletion through either.
  return applied && dispatched ? tr : null;
}

/**
 * The ids of the commands that can run at `state`'s selection, measured by
 * dry-running each one. Evaluated against the live document rather than
 * the post-delete one `confirmSlashCommand` builds: removing inline text
 * from a text block changes no block structure, so the two agree for every
 * command here — and where they could ever disagree, `confirmSlashCommand`
 * is the authority and refuses.
 */
export function applicableSlashCommandIds(state: EditorState): readonly string[] {
  return SLASH_COMMANDS.filter((command) => command.run(state)).map((command) => command.id);
}

/**
 * `applicable` is the id list from `applicableSlashCommandIds`. Omitting it
 * filters by query alone (the pure, state-free form the reducer's own
 * tests use); passing it is what keeps the menu from offering a block
 * transform that cannot run where the caret is — a command listed there
 * and then refused is worse than one that was never listed, because the
 * refusal has no place to explain itself.
 */
export function filterSlashCommands(query: string, applicable?: readonly string[]): readonly SlashCommand[] {
  const runnable = applicable ? SLASH_COMMANDS.filter((command) => applicable.includes(command.id)) : SLASH_COMMANDS;
  if (!query) return runnable;
  const needle = query.toLowerCase();
  return runnable.filter((command) => command.label.toLowerCase().includes(needle));
}

function toSummary(command: SlashCommand): SlashCommandSummary {
  return { id: command.id, label: command.label, description: command.description };
}

export const INACTIVE_SLASH_STATE: SlashState = { active: false, from: 0, to: 0, query: '', commands: [], selectedIndex: 0 };

export type SlashAction =
  | {
      readonly type: 'trigger';
      readonly from: number;
      readonly to: number;
      readonly query: string;
      /** Ids from `applicableSlashCommandIds`; omitted means "filter by query only". */
      readonly applicable?: readonly string[];
    }
  | { readonly type: 'moveSelection'; readonly delta: number }
  | { readonly type: 'noTrigger' }
  | { readonly type: 'dismiss' };

export function reduceSlashState(state: SlashState, action: SlashAction): SlashState {
  switch (action.type) {
    case 'trigger':
      return {
        active: true,
        from: action.from,
        to: action.to,
        query: action.query,
        commands: filterSlashCommands(action.query, action.applicable).map(toSummary),
        selectedIndex: 0,
      };
    case 'moveSelection':
      return { ...state, selectedIndex: moveSelection(state.selectedIndex, action.delta, state.commands.length) };
    case 'noTrigger':
    case 'dismiss':
      return INACTIVE_SLASH_STATE;
    default:
      return state;
  }
}

export const slashPluginKey = new PluginKey<SlashState>('slash');

export interface SlashPluginOptions {
  readonly onStateChange?: (state: SlashState) => void;
}

function textBeforeCursor(state: EditorState): string {
  const { $from } = state.selection;
  return $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
}

export function createSlashPlugin(options: SlashPluginOptions = {}): Plugin<SlashState> {
  return new Plugin<SlashState>({
    key: slashPluginKey,
    state: {
      init: () => INACTIVE_SLASH_STATE,
      apply(tr, value) {
        const action = tr.getMeta(slashPluginKey) as SlashAction | undefined;
        return action ? reduceSlashState(value, action) : value;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged || tr.selectionSet)) return null;
      if (!newState.selection.empty) return null;

      const action: SlashAction = isInsideCodeBlock(newState)
        ? { type: 'noTrigger' }
        : (() => {
            const match = matchTrigger(textBeforeCursor(newState), '/');
            return match
              ? {
                  type: 'trigger',
                  from: newState.selection.from - match.query.length - 1,
                  to: newState.selection.from,
                  query: match.query,
                  applicable: applicableSlashCommandIds(newState),
                }
              : { type: 'noTrigger' };
          })();

      return newState.tr.setMeta(slashPluginKey, action);
    },
    props: {
      handleKeyDown(view, event) {
        const state = slashPluginKey.getState(view.state);
        if (!state?.active) return false;

        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(slashPluginKey, { type: 'dismiss' } satisfies SlashAction));
          return true;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          view.dispatch(view.state.tr.setMeta(slashPluginKey, { type: 'moveSelection', delta } satisfies SlashAction));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const summary = state.commands[state.selectedIndex];
          if (!summary) return true; // no-results: inert
          // `state.commands` only ever holds the render-facing summary
          // (see `SlashCommandSummary`'s doc comment) — the runnable
          // command is looked up by id at confirm time.
          const command = SLASH_COMMANDS.find((candidate) => candidate.id === summary.id);
          if (!command) return true;

          // A `null` here means the command refused: dismiss the menu and
          // leave every character the user typed exactly where it is.
          const tr = confirmSlashCommand(view.state, command, { from: state.from, to: state.to });
          view.dispatch(tr ?? view.state.tr.setMeta(slashPluginKey, { type: 'dismiss' } satisfies SlashAction));
          return true;
        }
        return false;
      },
    },
    view() {
      return {
        update(view) {
          const state = slashPluginKey.getState(view.state);
          if (state) options.onStateChange?.(state);
        },
      };
    },
  });
}

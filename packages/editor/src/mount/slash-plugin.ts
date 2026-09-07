/**
 * The `/` slash command menu (document-editor spec: same keyboard-first
 * contract as `@` mentions, empty/no-results states, inert inside a code
 * block). Candidates are a fixed, local list of block-transform commands
 * — no network round trip, unlike mentions — so filtering is synchronous
 * and the reducer never needs a `setCandidates` action.
 */
import { setBlockType, wrapIn } from 'prosemirror-commands';
import type { NodeType } from 'prosemirror-model';
import { type EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { wrapInList } from 'prosemirror-schema-list';
import { schema } from '../schema';
import { isInsideCodeBlock, matchTrigger } from './trigger';

export interface SlashCommand {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly run: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean;
}

function typeOf(name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) throw new Error(`slash command references unknown node type "${name}"`);
  return type;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'heading-1', label: 'Heading 1', description: 'Big section heading', run: (s, d) => setBlockType(typeOf('heading'), { level: 1 })(s, d) },
  { id: 'heading-2', label: 'Heading 2', description: 'Medium section heading', run: (s, d) => setBlockType(typeOf('heading'), { level: 2 })(s, d) },
  { id: 'heading-3', label: 'Heading 3', description: 'Small section heading', run: (s, d) => setBlockType(typeOf('heading'), { level: 3 })(s, d) },
  { id: 'bullet-list', label: 'Bulleted list', description: 'A simple bulleted list', run: (s, d) => wrapInList(typeOf('list'), { ordered: false })(s, d) },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    description: 'A list with numbering',
    run: (s, d) => wrapInList(typeOf('list'), { ordered: true, start: 1 })(s, d),
  },
  { id: 'quote', label: 'Quote', description: 'A blockquote', run: (s, d) => wrapIn(typeOf('blockquote'))(s, d) },
  { id: 'code-block', label: 'Code block', description: 'A fenced code block', run: (s, d) => setBlockType(typeOf('code'))(s, d) },
  {
    id: 'divider',
    label: 'Divider',
    description: 'A horizontal rule',
    run: (s, d) => {
      d(s.tr.replaceSelectionWith(typeOf('thematicBreak').create()));
      return true;
    },
  },
];

export function filterSlashCommands(query: string): readonly SlashCommand[] {
  if (!query) return SLASH_COMMANDS;
  const needle = query.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.label.toLowerCase().includes(needle));
}

export interface SlashState {
  readonly active: boolean;
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly commands: readonly SlashCommand[];
  readonly selectedIndex: number;
}

export const INACTIVE_SLASH_STATE: SlashState = { active: false, from: 0, to: 0, query: '', commands: [], selectedIndex: 0 };

export type SlashAction =
  | { readonly type: 'trigger'; readonly from: number; readonly to: number; readonly query: string }
  | { readonly type: 'noTrigger' }
  | { readonly type: 'dismiss' };

export function reduceSlashState(state: SlashState, action: SlashAction): SlashState {
  switch (action.type) {
    case 'trigger':
      return { active: true, from: action.from, to: action.to, query: action.query, commands: filterSlashCommands(action.query), selectedIndex: 0 };
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
              ? { type: 'trigger', from: newState.selection.from - match.query.length - 1, to: newState.selection.from, query: match.query }
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
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') return true; // selection movement: host-driven, see mention-plugin.ts's same note
        if (event.key === 'Enter' || event.key === 'Tab') {
          const command = state.commands[state.selectedIndex];
          if (!command) return true; // no-results: inert

          // Two dispatches, not one transaction: `setBlockType`/`wrapIn`/
          // `wrapInList` are Commands that always build their own
          // transaction from the state they are given, so they cannot
          // append to an in-progress one. `prosemirror-history` groups
          // adjacent transactions (default 500ms window, no intervening
          // selection-only change) into a single undo step, and both
          // dispatches below happen synchronously in this one handler —
          // undo still removes the whole insertion as one step
          // (document-editor: "Mention And Slash Insertions Undo As One
          // Step").
          view.dispatch(view.state.tr.delete(state.from, state.to).setMeta(slashPluginKey, { type: 'dismiss' } satisfies SlashAction));
          command.run(view.state, view.dispatch);
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

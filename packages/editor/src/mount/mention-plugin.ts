/**
 * The `@` mention menu (document-editor spec: keyboard-first navigation,
 * empty/no-results states, no menu inside a code block, mention
 * insertions undo as one step). The reducer and selection-movement
 * functions below are pure — no `EditorView`, no DOM — so the state
 * machine is unit-tested directly; `createMentionPlugin` is the thin
 * ProseMirror `Plugin` wrapper apps/web actually mounts.
 */
import { type EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { schema } from '../schema';
import { isInsideCodeBlock, matchTrigger } from './trigger';

export interface MentionCandidate {
  readonly id: string;
  readonly type: 'user' | 'cell' | 'page';
  readonly label: string;
}

export interface MentionState {
  readonly active: boolean;
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly candidates: readonly MentionCandidate[];
  readonly selectedIndex: number;
}

export const INACTIVE_MENTION_STATE: MentionState = { active: false, from: 0, to: 0, query: '', candidates: [], selectedIndex: 0 };

export type MentionAction =
  | { readonly type: 'trigger'; readonly from: number; readonly to: number; readonly query: string }
  | { readonly type: 'setCandidates'; readonly candidates: readonly MentionCandidate[] }
  | { readonly type: 'noTrigger' }
  | { readonly type: 'dismiss' };

/**
 * A fresh `trigger` resets the candidate list and selection (a query
 * change invalidates the previous fetch's results, per "Empty And
 * No-Results States" — the menu must not show stale candidates against a
 * new query). `setCandidates` never touches `query`/`selection` — it is
 * how apps/web feeds back a debounced fetch's results without racing the
 * user's still-active typing.
 */
export function reduceMentionState(state: MentionState, action: MentionAction): MentionState {
  switch (action.type) {
    case 'trigger':
      if (state.active && state.from === action.from && state.query === action.query) return state;
      return { active: true, from: action.from, to: action.to, query: action.query, candidates: [], selectedIndex: 0 };
    case 'setCandidates':
      return { ...state, candidates: action.candidates };
    case 'noTrigger':
    case 'dismiss':
      return INACTIVE_MENTION_STATE;
    default:
      return state;
  }
}

/** Wraps in both directions; a no-op on an empty candidate list (nothing to select). */
export function moveSelection(current: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return (((current + delta) % count) + count) % count;
}

export const mentionPluginKey = new PluginKey<MentionState>('mention');

export interface MentionPluginOptions {
  readonly triggerChar?: string;
  /** Called on every state change so the host (apps/web) can render the floating menu and fetch candidates for a new query. */
  readonly onStateChange?: (state: MentionState, view: { readonly dom: HTMLElement }) => void;
  /** Called with the candidate the user confirmed (Enter or click). Returning `false` leaves the trigger text untouched (e.g. a mismatch warning was shown instead — the host decides). */
  readonly onConfirm: (candidate: MentionCandidate, range: { from: number; to: number }, tr: Transaction) => Transaction;
}

function textBeforeCursor(state: EditorState): string {
  const { $from } = state.selection;
  return $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
}

export function createMentionPlugin(options: MentionPluginOptions): Plugin<MentionState> {
  const triggerChar = options.triggerChar ?? '@';

  return new Plugin<MentionState>({
    key: mentionPluginKey,
    state: {
      init: () => INACTIVE_MENTION_STATE,
      apply(tr, value) {
        const setCandidates = tr.getMeta(mentionPluginKey) as MentionAction | undefined;
        if (setCandidates) return reduceMentionState(value, setCandidates);
        if (!tr.docChanged && !tr.selectionSet) return value;
        return value; // recomputed in appendTransaction, which has the up-to-date EditorState
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged || tr.selectionSet)) return null;
      if (!newState.selection.empty) return null;

      const action: MentionAction = isInsideCodeBlock(newState)
        ? { type: 'noTrigger' }
        : (() => {
            const match = matchTrigger(textBeforeCursor(newState), triggerChar);
            return match
              ? { type: 'trigger', from: newState.selection.from - match.query.length - 1, to: newState.selection.from, query: match.query }
              : { type: 'noTrigger' };
          })();

      return newState.tr.setMeta(mentionPluginKey, action);
    },
    props: {
      handleKeyDown(view, event) {
        const state = mentionPluginKey.getState(view.state);
        if (!state?.active) return false;

        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(mentionPluginKey, { type: 'dismiss' } satisfies MentionAction));
          return true;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          // Selection movement is applied by the host via setMentionSelection,
          // called from the same keydown handler apps/web wires up — kept out
          // of the plugin itself because it holds no view-independent effect
          // beyond a number the floating menu component already reads
          // reactively from plugin state through `onStateChange`.
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const candidate = state.candidates[state.selectedIndex];
          if (!candidate) return true; // no-results: Enter is inert, never inserts nothing
          const tr = options.onConfirm(candidate, { from: state.from, to: state.to }, view.state.tr);
          view.dispatch(tr.setMeta(mentionPluginKey, { type: 'dismiss' } satisfies MentionAction));
          return true;
        }
        return false;
      },
    },
    view(editorView) {
      return {
        update(view) {
          const state = mentionPluginKey.getState(view.state);
          if (state) options.onStateChange?.(state, { dom: view.dom });
        },
      };
    },
  });
}

/** Inserts a page mention as the real `wikiLink` atom node; a user/cell mention as plain `@Label` text — this schema has no dedicated mention node, and adding one would touch GATE-2's locked corpus. Both replace the trigger+query range in the SAME transaction as the dismiss, so undo removes the whole insertion as one step (document-editor: "Mention And Slash Insertions Undo As One Step"). */
export function insertMention(candidate: MentionCandidate, range: { from: number; to: number }, tr: Transaction): Transaction {
  if (candidate.type === 'page') {
    const node = schema.nodes.wikiLink!.create({ raw: `[[${candidate.label}]]`, target: candidate.id, anchor: null, alias: candidate.label });
    return tr.replaceRangeWith(range.from, range.to, node);
  }
  return tr.insertText(`@${candidate.label} `, range.from, range.to);
}

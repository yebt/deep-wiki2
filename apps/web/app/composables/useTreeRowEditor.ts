import type { NodeType } from '@deep-wiki/contracts';
import type { CreatedNode, RenamedNode } from './useTree';

/**
 * Naming a row where it lives: the state behind the tree's one editable
 * row, for both a creation and a rename.
 *
 * ── Why there is no dialog any more ────────────────────────────────────
 *
 * The owner rejected the tree's modal create and rename on 2026-09-23. A
 * dialog takes the person away from the place they just clicked and away
 * from the visual proof of *where* the new node will land — which matters
 * more, not less, in a typed hierarchy where "which book does this chapter
 * go in" is the whole question. Both reference products edit the name in
 * the row and for the same reason: VS Code swaps a row's label for an
 * input box (`explorerViewer.ts`'s `renderInputBox`, one code path for
 * creation and rename alike), and Obsidian creates the note and puts its
 * name straight into edit state. The research report in this batch's
 * scratchpad has the citations.
 *
 * So this composable holds what the dialog used to: the value being typed,
 * whether a request is in flight, and what a refusal did. One editable row
 * exists at a time, which is why the state is one nullable snapshot rather
 * than a set.
 *
 * ── The state machine ──────────────────────────────────────────────────
 *
 *   idle ──startCreate/startRename──▶ naming ──commit──▶ committing
 *     ▲                                 ▲                   │
 *     └──────cancel / success───────────┴───setValue─── error ◀┘
 *
 * `idle` is `state === null`. The three live phases are `naming` (the
 * person is typing), `committing` (the request is in flight, the typed
 * name still on screen) and `error` (the request was refused in a way the
 * person can fix by typing).
 *
 * ── Which refusals keep the field, and which take the row away ─────────
 *
 * Exactly the split the dialog already made, kept because it is about what
 * the person can do next (docs/UI-CHECKLIST.md §3 — an error offers a real
 * next action, and is never a dead end):
 *
 * - **A name collision (409)** is fixed by typing, so the field stays open
 *   with the typed text still in it and the server's own sentence beside
 *   it. Never a silent rename behind the person's back — the owner's
 *   criterion, and the reason the error is a phase rather than a toast.
 * - **Everything else** — no permission, a parent that has gone, an
 *   illegal type, a dead connection — cannot be fixed in that field, so
 *   the draft row goes away and the reason is handed to the tree, which
 *   shows it in the chip beside itself exactly where a refused drag's
 *   reason already appears.
 *
 * ── Two writes that never happen ───────────────────────────────────────
 *
 * A blank name writes nothing and keeps the field (VS Code's input box
 * refuses an invalid name and stays open). A rename to the name the row
 * already has writes nothing either and simply closes — the person
 * pressed Enter on an unchanged field, which is a way of saying "leave it
 * alone", not a request to spend a revision on it. And a cancel cannot
 * outrun a write: Escape during `committing` is ignored, so there is no
 * window in which the row is gone from the screen and still arriving on
 * the server.
 */

export interface CreateNodeBody {
  readonly parentId: string;
  readonly type: NodeType;
  readonly title: string;
}

/** What `POST /nodes` answers, with the type the tree needs to draw the row's icon. */
export interface CreatedNodePayload extends CreatedNode {
  readonly type: NodeType;
}

export type CreateNodeFetcher = (body: CreateNodeBody) => Promise<CreatedNodePayload>;
export type RenameNodeFetcher = (nodeId: string, body: { title: string }) => Promise<RenamedNode>;

export interface CreateDraft {
  readonly mode: 'create';
  /** The row the new node goes under — the workspace root for a top-level shelf. */
  readonly parentId: string;
  readonly type: NodeType;
  /** The indent the draft row is drawn at: 0 at the top level, the parent's depth + 1 below it. */
  readonly depth: number;
  /** The parent's title, for the announcement; `null` at the top level. */
  readonly parentTitle: string | null;
}

export interface RenameDraft {
  readonly mode: 'rename';
  readonly nodeId: string;
  readonly type: NodeType;
  /** What the row was called when the field opened: a commit that matches it writes nothing. */
  readonly originalTitle: string;
}

export type Draft = CreateDraft | RenameDraft;

export type EditorPhase = 'naming' | 'committing' | 'error';

export interface EditorSnapshot {
  readonly draft: Draft;
  readonly phase: EditorPhase;
  readonly value: string;
  /** The refusal beside the field; present exactly in the `error` phase. */
  readonly error: string | null;
}

export type CommitOutcome =
  /** The server made the node: draw it, select it, open it. */
  | { readonly kind: 'created'; readonly node: CreatedNodePayload }
  /** The server stored the new name: patch the row. */
  | { readonly kind: 'renamed'; readonly node: RenamedNode }
  /** Enter on an unchanged name: nothing was written, and nothing needs drawing. */
  | { readonly kind: 'unchanged'; readonly nodeId: string }
  /** Refused in a way typing can fix: the field is still open with the reason in it. */
  | { readonly kind: 'kept' }
  /** Refused in a way typing cannot fix: the draft is gone, and this reason belongs beside the tree. */
  | { readonly kind: 'abandoned'; readonly message: string }
  /** Nothing to do: a blank name, or a second Enter while the first is in flight. */
  | { readonly kind: 'ignored' };

export type CancelOutcome =
  /** The field closed with nothing written; focus goes back to the row this names. */
  | { readonly kind: 'cancelled'; readonly draft: Draft }
  /** Nothing was open, or a write is in flight and may not be abandoned. */
  | { readonly kind: 'ignored' };

/**
 * What the tree hands down to the row that is being named: the snapshot to
 * draw and the three ways to answer it. One prop threaded through the
 * recursion, the way `collapsedIds` already is — rather than three events
 * re-emitted at every level, which is how a four-deep tree loses a key
 * press (`NavigationTreeNode`'s own `keydown` note).
 */
export interface TreeRowEditorBinding {
  readonly snapshot: EditorSnapshot;
  readonly setValue: (value: string) => void;
  readonly commit: () => void;
  readonly cancel: () => void;
}

export interface UseTreeRowEditorDeps {
  readonly createFetcher?: CreateNodeFetcher;
  readonly renameFetcher?: RenameNodeFetcher;
}

export interface UseTreeRowEditorResult {
  /** The one editable row, or `null` when nothing is being named. */
  readonly state: Ref<EditorSnapshot | null>;
  readonly isEditing: ComputedRef<boolean>;
  readonly startCreate: (target: { parentId: string; type: NodeType; depth: number; parentTitle: string | null }) => void;
  readonly startRename: (node: { id: string; type: string; title: string }) => void;
  readonly setValue: (value: string) => void;
  readonly cancel: () => CancelOutcome;
  readonly commit: () => Promise<CommitOutcome>;
}

export interface WriteRefusal {
  /** The person can fix this by typing, so the field stays open. */
  readonly keepsField: boolean;
  readonly message: string;
}

/**
 * One classification of a refused write, for both the create and the
 * rename — the dialog's own, moved here whole. `~/utils/fetch-error`'s
 * shared guards do the reading; nothing here parses a response by hand.
 */
export function classifyWriteRefusal(error: unknown, mode: 'create' | 'rename'): WriteRefusal {
  const status = httpStatusOf(error);
  const body = responseBodyOf(error) as { error?: string } | undefined;

  if (status === 409) {
    return { keepsField: true, message: body?.error ?? 'Something here already has that name. Choose another.' };
  }
  if (status === 403) {
    return {
      keepsField: false,
      message:
        mode === 'create'
          ? "You don't have permission to create anything here. Ask a workspace admin for write access."
          : "You don't have permission to rename this. Ask a workspace admin for write access.",
    };
  }
  if (status === 404) {
    return { keepsField: false, message: 'That place is no longer there. Reload the tree and try again.' };
  }
  if (status === 400) {
    return { keepsField: false, message: body?.error ?? 'That is not something that can go here.' };
  }
  return { keepsField: false, message: 'Cannot reach the server. Check your connection and try again.' };
}

export function useTreeRowEditor(deps: UseTreeRowEditorDeps = {}): UseTreeRowEditorResult {
  const state = ref<EditorSnapshot | null>(null);

  /**
   * Which draft a settled request belongs to. A refusal that arrives after
   * the person has started naming something else belongs to nothing, and
   * must not reopen a field over the row they are on now.
   */
  let generation = 0;

  function createNode(body: CreateNodeBody): Promise<CreatedNodePayload> {
    if (deps.createFetcher) return deps.createFetcher(body);
    const config = useRuntimeConfig();
    return $fetch(`${config.public.apiBaseUrl}/nodes`, { method: 'POST', credentials: 'include', body });
  }

  function renameNode(nodeId: string, body: { title: string }): Promise<RenamedNode> {
    if (deps.renameFetcher) return deps.renameFetcher(nodeId, body);
    const config = useRuntimeConfig();
    return $fetch(`${config.public.apiBaseUrl}/nodes/${nodeId}`, { method: 'PATCH', credentials: 'include', body });
  }

  function open(draft: Draft, value: string): void {
    generation += 1;
    state.value = { draft, phase: 'naming', value, error: null };
  }

  function startCreate(target: { parentId: string; type: NodeType; depth: number; parentTitle: string | null }): void {
    open({ mode: 'create', ...target }, '');
  }

  function startRename(node: { id: string; type: string; title: string }): void {
    open({ mode: 'rename', nodeId: node.id, type: node.type as NodeType, originalTitle: node.title }, node.title);
  }

  /** Typing after a refusal clears it: the message was about the name that was sent, not the one being typed. */
  function setValue(value: string): void {
    const current = state.value;
    if (!current || current.phase === 'committing') return;
    state.value = { ...current, value, phase: 'naming', error: null };
  }

  function cancel(): CancelOutcome {
    const current = state.value;
    if (!current || current.phase === 'committing') return { kind: 'ignored' };
    generation += 1;
    state.value = null;
    return { kind: 'cancelled', draft: current.draft };
  }

  async function commit(): Promise<CommitOutcome> {
    const current = state.value;
    if (!current || current.phase === 'committing') return { kind: 'ignored' };
    const title = current.value.trim();
    if (title.length === 0) return { kind: 'ignored' };
    if (current.draft.mode === 'rename' && title === current.draft.originalTitle) {
      generation += 1;
      state.value = null;
      return { kind: 'unchanged', nodeId: current.draft.nodeId };
    }

    const mine = generation;
    state.value = { ...current, phase: 'committing', error: null };
    try {
      if (current.draft.mode === 'create') {
        const node = await createNode({ parentId: current.draft.parentId, type: current.draft.type, title });
        if (generation !== mine) return { kind: 'ignored' };
        state.value = null;
        return { kind: 'created', node };
      }
      const node = await renameNode(current.draft.nodeId, { title });
      if (generation !== mine) return { kind: 'ignored' };
      state.value = null;
      return { kind: 'renamed', node };
    } catch (error) {
      if (generation !== mine) return { kind: 'ignored' };
      const refusal = classifyWriteRefusal(error, current.draft.mode);
      if (refusal.keepsField) {
        state.value = { ...current, phase: 'error', error: refusal.message };
        return { kind: 'kept' };
      }
      state.value = null;
      return { kind: 'abandoned', message: refusal.message };
    }
  }

  return {
    state,
    isEditing: computed(() => state.value !== null),
    startCreate,
    startRename,
    setValue,
    cancel,
    commit,
  };
}

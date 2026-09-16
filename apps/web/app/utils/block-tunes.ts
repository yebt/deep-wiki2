/**
 * The block handle's tunes menu, decided without a DOM or a document.
 *
 * `EditorSurface` holds the `EditorHandle` and dry-runs its commands
 * (`packages/editor/src/mount/block-commands.ts`: every one answers
 * `false` where it cannot apply, dispatching nothing); this turns those
 * answers into the menu — what is offered, what is withheld and *why*,
 * because a disabled item with no reason is a defect (docs/UI-CHECKLIST.md
 * §3) and the reason must survive keyboard focus (§5). Kept out of the
 * component so the decision is testable without ProseMirror, the way
 * `menu-position.ts` keeps the menus' geometry.
 *
 * Two selection helpers live here too, over the members of `EditorView`
 * they touch. `placeCaretIn` exists because the handle tunes the block
 * under the *pointer* while every block command acts on the block the
 * *selection* is in, and `EditorHandle` exposes nothing that moves the
 * selection (recorded in docs/TODO.md, 2026-09-16). The `Selection` class
 * is reached through the state's own selection instance: every state's
 * selection is a `Selection` subclass and `near` is a static each one
 * inherits — no `prosemirror-state` import in apps/web, which is not a
 * dependency of this package and must not become one.
 */
import type { Selection } from 'prosemirror-state';

/**
 * The `/` commands "Turn into" offers, Text first (docs/TODO.md: a caret
 * in a list item turned straight into a heading yields `- # Title`, so
 * the way out of a list is Text). Divider, table and footnote are
 * insertions — they add a block beside the caret rather than retyping
 * this one — so they stay in the `/` menu and out of this list.
 */
export const TURN_INTO_TARGET_IDS: readonly string[] = [
  'text',
  'heading-1',
  'heading-2',
  'heading-3',
  'bullet-list',
  'numbered-list',
  'task-list',
  'quote',
  'code-block',
];

/** Why a block cannot be turned into anything (`BLOCK_COMMANDS_NOT_TURNABLE`), by node type. */
const NOT_TURNABLE_REASONS: Readonly<Record<string, string>> = {
  table: 'A table is cell structure; it can’t be turned into another block.',
  footnoteDefinition: 'A footnote is addressed by its number from elsewhere; it can’t be turned into another block.',
  verbatim: 'Raw source stays as it is; it can’t be turned into another block.',
};

export interface TurnIntoTarget {
  readonly id: string;
  readonly label: string;
  /** `turnInto(id)` dry-run on the block: `true` where it would apply. */
  readonly applicable: boolean;
}

export interface TunesInput {
  /** `node.type.name` of the top-level block. */
  readonly blockType: string;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly canDuplicate: boolean;
  readonly canDelete: boolean;
  readonly turnInto: readonly TurnIntoTarget[];
  /** The target the block already is (`currentTurnIntoTarget`), disabled as "already", or `null`. */
  readonly currentTargetId: string | null;
}

export interface TunesActions {
  moveUp(): void;
  moveDown(): void;
  duplicate(): void;
  remove(): void;
  turnInto(id: string): void;
}

/** One menu row, in the shape `UDropdownMenu` takes. */
export interface TunesItem {
  readonly label: string;
  readonly icon: string;
  readonly disabled?: boolean;
  /** The reason, shown under the label while the item is disabled. */
  readonly description?: string;
  readonly kbds?: string[];
  readonly children?: readonly TunesItem[];
  readonly onSelect?: () => void;
}

function row(label: string, icon: string, can: boolean, reason: string, run: () => void, kbds?: string[]): TunesItem {
  return can ? { label, icon, kbds, onSelect: run } : { label, icon, kbds, disabled: true, description: reason };
}

function turnIntoItem(input: TunesInput, actions: TunesActions): TunesItem {
  const notTurnable = NOT_TURNABLE_REASONS[input.blockType];
  if (notTurnable) return { label: 'Turn into', icon: 'i-lucide-replace', disabled: true, description: notTurnable };
  return {
    label: 'Turn into',
    icon: 'i-lucide-replace',
    children: input.turnInto.map((target) => {
      if (target.id === input.currentTargetId) {
        return { label: target.label, icon: slashCommandIcon(target.id), disabled: true, description: `Already a ${target.label.toLowerCase()}.` };
      }
      return row(target.label, slashCommandIcon(target.id), target.applicable, 'Not available for this block.', () => actions.turnInto(target.id));
    }),
  };
}

/** The tunes menu: Turn into, then the two moves with their keys, Duplicate and Delete. */
export function blockTunesMenu(input: TunesInput, actions: TunesActions): TunesItem[][] {
  return [
    [turnIntoItem(input, actions)],
    [
      row('Move up', 'i-lucide-arrow-up', input.canMoveUp, 'Already the first block.', () => actions.moveUp(), ['alt', 'arrowup']),
      row('Move down', 'i-lucide-arrow-down', input.canMoveDown, 'Already the last block.', () => actions.moveDown(), ['alt', 'arrowdown']),
    ],
    [
      row('Duplicate', 'i-lucide-copy', input.canDuplicate, 'This block can’t be duplicated.', () => actions.duplicate()),
      row('Delete', 'i-lucide-trash-2', input.canDelete, 'This block can’t be deleted.', () => actions.remove()),
    ],
  ];
}

/** The icon each `/` command and "Turn into" target carries beside its label — never instead of it (§4.3). */
export function slashCommandIcon(id: string): string {
  return SLASH_COMMAND_ICONS[id] ?? 'i-lucide-square';
}

const SLASH_COMMAND_ICONS: Readonly<Record<string, string>> = {
  'text': 'i-lucide-pilcrow',
  'heading-1': 'i-lucide-heading-1',
  'heading-2': 'i-lucide-heading-2',
  'heading-3': 'i-lucide-heading-3',
  'bullet-list': 'i-lucide-list',
  'numbered-list': 'i-lucide-list-ordered',
  'task-list': 'i-lucide-list-checks',
  'quote': 'i-lucide-text-quote',
  'code-block': 'i-lucide-code-xml',
  'divider': 'i-lucide-minus',
  'table': 'i-lucide-table',
  'footnote': 'i-lucide-footprints',
};

/** The parts of a ProseMirror `Node` `currentTurnIntoTarget` reads. */
export interface BlockLike {
  readonly type: { readonly name: string };
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly firstChild: { readonly attrs: Readonly<Record<string, unknown>> } | null;
}

/** The "Turn into" target a block already is — so the menu can say "Already a heading 2" rather than a bare refusal — or `null` when none matches. */
export function currentTurnIntoTarget(node: BlockLike): string | null {
  switch (node.type.name) {
    case 'paragraph':
      return 'text';
    case 'heading':
      return `heading-${String(node.attrs.level)}`;
    case 'blockquote':
      return 'quote';
    case 'code':
      return 'code-block';
    case 'list':
      if (node.attrs.ordered) return 'numbered-list';
      return node.firstChild && node.firstChild.attrs.checked !== null && node.firstChild.attrs.checked !== undefined ? 'task-list' : 'bullet-list';
    default:
      return null;
  }
}

/** The members of `EditorState` `caretBlock` reads; `N` is the node type the document answers with. */
export interface CaretState<N> {
  readonly doc: {
    resolve(pos: number): { readonly depth: number; before?(depth: number): number };
    nodeAt(pos: number): N | null | undefined;
  };
  readonly selection: { readonly from: number };
}

/**
 * The top-level block the selection is in — the depth-1 ancestor of a
 * caret, the node itself when it is selected whole — or `null` for a gap
 * cursor, which sits between blocks (`topLevelBlock` in block-commands.ts
 * decides the same way; this is the host's copy over a `resolve` it can
 * reach, for placing the handle at the keyboard's block).
 */
export function caretBlock<N>(state: CaretState<N>): { pos: number; node: N } | null {
  const $from = state.doc.resolve(state.selection.from);
  const pos = $from.depth === 0 || !$from.before ? state.selection.from : $from.before(1);
  const node = state.doc.nodeAt(pos);
  return node ? { pos, node } : null;
}

/** The members of `EditorView` `placeCaretIn` touches. */
export interface CaretView {
  readonly state: {
    readonly doc: { readonly content: { readonly size: number }; resolve(pos: number): unknown };
    readonly selection: object;
    readonly tr: { setSelection(selection: Selection): unknown };
  };
  dispatch(tr: unknown): void;
}

/**
 * Puts the selection inside the top-level block at `pos` — the nearest
 * valid one from its start, so a paragraph gets a caret at its first
 * character, a list its first item's, a divider is selected whole — and
 * `false`, dispatching nothing, for a position outside the document.
 */
export function placeCaretIn(view: CaretView, pos: number): boolean {
  const { doc, selection } = view.state;
  if (pos < 0 || pos >= doc.content.size) return false;
  const SelectionClass = selection.constructor as unknown as typeof Selection;
  view.dispatch(view.state.tr.setSelection(SelectionClass.near(doc.resolve(pos) as never, 1)));
  return true;
}

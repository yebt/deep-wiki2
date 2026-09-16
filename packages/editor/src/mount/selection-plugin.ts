/**
 * What a floating (bubble) toolbar needs to know about the selection,
 * split the same way the mention/slash plugins are: a DOM-free reducer
 * (`selectionSnapshot`) that decides *what* to show — which marks are
 * active, whether there is a range at all — and a plugin `view()` that
 * adds *where* (`coordsAtPos`, the only DOM measurement) and reports the
 * pair to the host through `onChange`.
 *
 * The reducer never reads the DOM, so `selection-plugin.test.ts` proves
 * the mark logic against real documents; the view half is driven there
 * with a stubbed `coordsAtPos`. apps/web positions the toolbar from the
 * reported `coords` exactly as it positions the mention menu from
 * `coordsAtPos(state.from)` today.
 */
import { GapCursor } from 'prosemirror-gapcursor';
import type { MarkType } from 'prosemirror-model';
import { EditorState, NodeSelection, Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../schema';

/** The marks the bubble toolbar offers, in button order. Every one is a pinned Markdown spelling (`**`, `_`, `~~`, `` ` ``, `[text](url)`). */
export const TOOLBAR_MARKS = ['strong', 'emphasis', 'delete', 'inlineCode', 'link'] as const;
export type ToolbarMarkName = (typeof TOOLBAR_MARKS)[number];

export interface LinkAttrs {
  readonly href: string;
  readonly title: string | null;
}

export interface SelectionSnapshot {
  /**
   * `text`: a caret or range inside ordinary text — the toolbar's case;
   * `code`: inside a code block, where no inline mark applies;
   * `node`: a whole block or atom is selected (drag handle, verbatim);
   * `gap`: a gap cursor beside a textless block.
   */
  readonly kind: 'text' | 'code' | 'node' | 'gap';
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
  /** Per toolbar mark: active across the whole range, or stored at the caret. */
  readonly marks: Readonly<Record<ToolbarMarkName, boolean>>;
  /** The link the caret or range sits in, for an Edit-link field to prefill; `null` when `marks.link` is `false`. */
  readonly link: LinkAttrs | null;
}

/** A `coordsAtPos` result — viewport-relative, like `getBoundingClientRect()`. */
export interface Rect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface SelectionCoords {
  readonly from: Rect;
  readonly to: Rect;
}

export interface SelectionReport extends SelectionSnapshot {
  readonly coords: SelectionCoords;
}

const NO_MARKS: Readonly<Record<ToolbarMarkName, boolean>> = {
  strong: false,
  emphasis: false,
  delete: false,
  inlineCode: false,
  link: false,
};

function markType(name: ToolbarMarkName): MarkType {
  const type = schema.marks[name];
  if (!type) throw new Error(`selection plugin references unknown mark "${name}"`);
  return type;
}

/**
 * At a caret the stored marks (what the next typed character receives)
 * decide. Over a range the mark must cover the WHOLE range — a range half
 * in bold reports bold OFF, so the Bold button reads as "make all of this
 * bold", which is what `toggleMarkCommand` (`editor-commands.ts`,
 * `removeWhenPresent: false`) then does. The walk mirrors that option's
 * own: whitespace-only text and content that cannot carry the mark at all
 * (nothing inside this schema's `code` block can) do not count as
 * missing it. `rangeHasMark` — prosemirror-example-setup's choice — is
 * the opposite reading ("any of it is bold"), and pairs with the default
 * `toggleMark`, which removes on a partial range; the two must agree or
 * the button lies about what its click will do.
 */
function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) return type.isInSet(state.storedMarks ?? $from.marks()) !== undefined;
  let missing = false;
  let seen = false;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (missing || !node.isInline || !parent?.type.allowsMarkType(type)) return !missing;
    const text = node.isText ? node.textBetween(Math.max(0, from - pos), Math.min(node.nodeSize, to - pos)) : null;
    if (text !== null && /^\s*$/.test(text)) return true;
    seen = true;
    missing = type.isInSet(node.marks) === undefined;
    return !missing;
  });
  return seen && !missing;
}

/** The link mark's attrs at the selection's start, or `null`. */
function linkAt(state: EditorState): LinkAttrs | null {
  const type = markType('link');
  const { $from, empty } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : $from.marksAcross(state.selection.$to) ?? $from.marks();
  const found = type.isInSet(marks) ?? (empty ? undefined : $from.nodeAfter?.marks.find((mark) => mark.type === type));
  if (!found) return null;
  return { href: found.attrs.href as string, title: (found.attrs.title as string | null) ?? null };
}

export function selectionSnapshot(state: EditorState): SelectionSnapshot {
  const { selection } = state;
  const { from, to, empty } = selection;

  if (selection instanceof NodeSelection) return { kind: 'node', from, to, empty, marks: NO_MARKS, link: null };
  if (selection instanceof GapCursor) return { kind: 'gap', from, to, empty, marks: NO_MARKS, link: null };
  if (selection.$from.parent.type.spec.code) return { kind: 'code', from, to, empty, marks: NO_MARKS, link: null };

  const marks = Object.fromEntries(TOOLBAR_MARKS.map((name) => [name, isMarkActive(state, markType(name))])) as Record<
    ToolbarMarkName,
    boolean
  >;
  return { kind: 'text', from, to, empty, marks, link: marks.link ? linkAt(state) : null };
}

function sameSnapshot(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return (
    a.kind === b.kind &&
    a.from === b.from &&
    a.to === b.to &&
    a.empty === b.empty &&
    TOOLBAR_MARKS.every((name) => a.marks[name] === b.marks[name]) &&
    a.link?.href === b.link?.href &&
    a.link?.title === b.link?.title
  );
}

/** The DOM measurement, and the only one: both ends of the selection, so a toolbar can centre over the range or sit beside a caret. */
function measure(view: Pick<EditorView, 'coordsAtPos'>, snapshot: SelectionSnapshot): SelectionCoords {
  return { from: view.coordsAtPos(snapshot.from, 1), to: view.coordsAtPos(snapshot.to, -1) };
}

export const selectionPluginKey = new PluginKey('selection');

export interface SelectionPluginOptions {
  readonly onChange?: (report: SelectionReport) => void;
}

/**
 * Reports through `onChange` only when the snapshot changed — the
 * selection moved, or a mark at the caret toggled — never on every
 * transaction, so the host's toolbar does not re-render for a keystroke
 * that changed nothing it shows.
 */
export function createSelectionPlugin(options: SelectionPluginOptions = {}): Plugin {
  return new Plugin({
    key: selectionPluginKey,
    view(editorView) {
      let last = selectionSnapshot(editorView.state);
      options.onChange?.({ ...last, coords: measure(editorView, last) });
      return {
        update(view) {
          const next = selectionSnapshot(view.state);
          if (sameSnapshot(last, next)) return;
          last = next;
          options.onChange?.({ ...next, coords: measure(view, next) });
        },
      };
    },
  });
}

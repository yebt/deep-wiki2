/**
 * Wires the real ProseMirror schema (packages/editor/src/schema.ts) into
 * an actual `EditorView` — the browser editing surface behind the
 * `"./mount"` export. Built directly on `prosemirror-view`/`-state`/
 * `-keymap`/`-commands`/`-history`/`-inputrules`/`-schema-list` rather
 * than the `milkdown` package: design.md's own testing-strategy section
 * describes the live-preview mechanism in plain ProseMirror vocabulary
 * (Decorations, `addToHistory: false`), and this schema is a real
 * semantic ProseMirror schema built for THIS project's own
 * `fromMarkdown`/`toMarkdown` pipeline — wrapping actual Milkdown around
 * a foreign document model would mean reconciling two schemas instead of
 * one, for no behaviour this file does not already provide directly.
 *
 * Needs a real DOM (`document`, `Range`, `Selection`) and is therefore
 * exercised by apps/web's own tests and the e2e suite, not by
 * packages/editor's own DOM-free `bun test` — see mention-plugin.ts and
 * slash-plugin.ts for the DOM-independent state-machine logic this
 * factory only wires together.
 */
import { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../schema';
import { createEditorCommands, describeUpdate, type EditorCommands, type EditorUpdate } from './editor-commands';
import { insertMention, type MentionPluginOptions } from './mention-plugin';
import { buildEditorPlugins } from './plugins';
import type { SlashPluginOptions } from './slash-plugin';

export interface CreateEditorViewOptions {
  readonly dom: HTMLElement;
  /** The starting document, already produced by `fromMarkdown()` (root `"."` export) — this module never parses Markdown itself. */
  readonly doc: Node;
  readonly editable?: boolean;
  /** Fired after every transaction with the summary a toolbar renders from (`editor-commands.ts`: undo/redo depths). */
  readonly onUpdate?: (view: EditorView, update: EditorUpdate) => void;
  readonly mention?: Omit<MentionPluginOptions, 'onConfirm'> & {
    /** Fired once a candidate is confirmed and inserted — apps/web uses this to run the "Mentioning A User Does Not Silently Grant Them Access" check, which needs a network round trip this package never makes itself. */
    readonly onConfirmed?: (candidate: Parameters<MentionPluginOptions['onConfirm']>[0]) => void;
  };
  readonly slash?: SlashPluginOptions;
}

/**
 * design.md's live-preview rule requires an asynchronously-mounted node
 * view to reserve its height so mounting cannot reflow content under the
 * cursor. This schema's only atom nodes (`verbatim`/`verbatimInline`,
 * `wikiLink`, `tag`) all render synchronously through the default
 * `toDOM` — no node view here mounts asynchronously yet, so there is
 * nothing to reserve height for today. Recorded rather than silently
 * assumed solved: a future async node view (e.g. a live diagram preview)
 * MUST reserve its height before this rule is satisfied for it too.
 */
export function createEditorView(options: CreateEditorViewOptions): EditorView {
  const state = EditorState.create({
    schema,
    doc: options.doc,
    // The list itself (order, gap cursor, drop cursor) lives in plugins.ts
    // where `bun test` can reach it; this DOM-bound file only installs it.
    plugins: buildEditorPlugins({
      mention: {
        ...options.mention,
        onConfirm: (candidate, range, tr) => {
          options.mention?.onConfirmed?.(candidate);
          return insertMention(candidate, range, tr);
        },
      },
      slash: options.slash,
    }),
  });

  let transactionCount = 0;
  // `{ mount: options.dom }` rather than `new EditorView(options.dom, …)`:
  // the legacy `place`-node form APPENDS a new contentEditable child
  // inside the given element instead of making the element itself
  // editable, leaving apps/web's own `data-testid="editor-surface"` node
  // a non-editable wrapper one level removed from where ProseMirror
  // actually places the caret. `mount` makes the passed element itself
  // the editable surface, matching what EditorSurface.vue's template and
  // its e2e/manual tests actually click and type into.
  const view = new EditorView({ mount: options.dom }, {
    state,
    editable: () => options.editable ?? true,
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      transactionCount += 1;
      options.onUpdate?.(view, describeUpdate(next, transactionCount));
    },
  });
  return view;
}

/**
 * What the host holds after mounting: the live view plus the command
 * surface (`editor-commands.ts`) bound to it. `view` stays exposed for
 * what the commands do not cover — `focus()`, `coordsAtPos()` for menu
 * placement, `state` for the plugins' own keys — and `destroy()` tears
 * the view down.
 */
export interface EditorHandle extends EditorCommands {
  readonly view: EditorView;
  destroy(): void;
}

/**
 * `createEditorView` plus the command surface, in one object. This is the
 * entry point the Vue surface should hold; `createEditorView` remains
 * exported for the current caller and for hosts that only need the view.
 */
export function mountEditor(options: CreateEditorViewOptions): EditorHandle {
  const view = createEditorView(options);
  return { view, ...createEditorCommands(view), destroy: () => view.destroy() };
}

/**
 * The ordered plugin list the editing surface runs on, built without a
 * DOM so `plugins.test.ts` can drive it against a plain `EditorState`.
 * `createEditorView` only wires this list into a real `EditorView`.
 *
 * Order matters and is deliberate:
 *
 *   1. keymap — the user's own bindings win over every default;
 *   2. history;
 *   3. input rules;
 *   4. gap cursor — claims ArrowUp/Down/Left/Right only when the selection
 *      is a node or gap selection, so it never competes with the menus
 *      below (a menu is only ever open over a text selection);
 *   5. drop cursor — its `view()` half registers `dragover`/`drop`/
 *      `dragend`/`dragleave` on the surface and draws the insertion
 *      marker; a plain `Plugin` with no state, so its position is free;
 *   6. mention, 7. slash — the two menus, after everything that could
 *      claim a key, so an open menu's Enter/Arrow handling has already
 *      been offered every earlier chance to be refused;
 *   8. selection — reports only, claims no key; last so it observes the
 *      state every other plugin has finished with.
 *
 * Why the gap cursor is here at all: this schema has three block types
 * that hold no text — `thematicBreak`, `table` (cells do, the block does
 * not) and `code` (`Mod-Enter` exits it, nothing else) — and a document
 * ENDING in one of them had no keyboard path to a paragraph after it.
 * `prosemirror-gapcursor` gives every such boundary a caret position; the
 * `Selection.replace` machinery already knows how to wrap text typed
 * there in a paragraph. `prosemirror-dropcursor` is the visual half of
 * block drag (`block-drag.ts`): ProseMirror's own drop handling moves the
 * node, the drop cursor shows where.
 *
 * Both packages are allowed here and forbidden in the `"."` export's
 * closure (`scripts/checks/bundle-isolation.ts`): they are editing
 * surface, exactly like `prosemirror-view`.
 */
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { inputRules } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import { schema } from '../schema';
import { buildInputRules } from './input-rules';
import { buildHistory, buildKeymap } from './keymap';
import { createMentionPlugin, insertMention, type MentionPluginOptions } from './mention-plugin';
import { createSelectionPlugin, type SelectionPluginOptions } from './selection-plugin';
import { createSlashPlugin, type SlashPluginOptions } from './slash-plugin';

/**
 * The class the drop-cursor element carries, so apps/web's stylesheet
 * owns its colour through the design system's tokens (`color: false`
 * stops the package painting its default black inline).
 */
export const DROP_CURSOR_CLASS = 'editor-drop-cursor';

export interface BuildEditorPluginsOptions {
  readonly mention?: MentionPluginOptions;
  readonly slash?: SlashPluginOptions;
  readonly selection?: SelectionPluginOptions;
}

export function buildEditorPlugins(options: BuildEditorPluginsOptions = {}): Plugin[] {
  return [
    buildKeymap(),
    buildHistory(),
    inputRules({ rules: buildInputRules(schema) }),
    gapCursor(),
    dropCursor({ class: DROP_CURSOR_CLASS, color: false, width: 2 }),
    // Without a host-supplied `onConfirm`, a confirmed mention is simply inserted.
    createMentionPlugin(options.mention ?? { onConfirm: insertMention }),
    createSlashPlugin(options.slash),
    createSelectionPlugin(options.selection),
  ];
}

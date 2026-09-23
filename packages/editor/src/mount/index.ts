/**
 * The editing surface (design.md "Read mode never reaches the ProseMirror
 * bundle", layer 1 — the `"./mount"` export). Everything reachable from
 * here is what `scripts/checks/bundle-isolation.ts` forbids the root
 * `"."` export from ever statically reaching, and what
 * `scripts/checks/bundle-isolation-build.ts` forbids `apps/web`'s
 * read-mode route from statically importing (only a dynamic `import()`
 * is allowed). `packages/editor/src/index.ts` (the `"."` export) MUST
 * NEVER re-export anything from this module — see its own doc comment
 * and `index.test.ts`.
 */
export { createEditorView, mountEditor } from './create-editor-view';
export type { CreateEditorViewOptions, EditorHandle } from './create-editor-view';

export { createEditorCommands, describeUpdate, toggleMarkCommand } from './editor-commands';
export type { CommandTarget, EditorCommands, EditorUpdate, ToggleableMarkName } from './editor-commands';

export { createSelectionPlugin, selectionPluginKey, selectionSnapshot, TOOLBAR_MARKS } from './selection-plugin';
export type { LinkAttrs, Rect, SelectionCoords, SelectionPluginOptions, SelectionReport, SelectionSnapshot, ToolbarMarkName } from './selection-plugin';

/**
 * The converters, re-exported from the `"."` side so the host that mounts
 * the surface can take them from THIS chunk. apps/web's `EditorSurface`
 * used to import them statically from `@deep-wiki/editor`, which put the
 * whole remark/micromark/mdast stack in the edit route's pre-hydration
 * chunk (dev: 14 requests, 2.3 MB; prod: most of a 199 KB chunk) although
 * nothing needs a parser until the edit-session response has arrived and
 * this chunk has loaded anyway (docs/TODO.md Findings 2026-09-16,
 * "edit-mode latency"). Same bindings, not copies — `index.test.ts` here
 * holds them identical to the `"."` export's, so there is still exactly one
 * parser. The reverse direction stays forbidden: `../index.ts` never
 * re-exports anything from here.
 */
export { fromMarkdown, UnsupportedConstructError } from '../from-markdown';
export { toMarkdown } from '../to-markdown';
// The probe too, for the same reason and with the same identity rule:
// source mode (apps/web, 2026-09-17) asks it whether the text a person
// typed may open in the visual view, and it is the one fail-closed check
// the edit-session route already applies before opening a page.
export { probe } from '../probe';
export type { ProbeResult } from '../probe';
// And the round trip itself, which is source mode's Format action (owner
// decision, 2026-09-23): the canonical form of a buffer is by definition
// the text `probe` compares against, so the action that writes it and the
// check that reads it are one function rather than two spellings of one
// idea. GATE-2's own harness, used as a formatter.
export { roundTrip } from '../round-trip';

export { createMentionPlugin, insertMention, mentionPluginKey, moveSelection, reduceMentionState, INACTIVE_MENTION_STATE } from './mention-plugin';
export type { MentionAction, MentionCandidate, MentionPluginOptions, MentionState } from './mention-plugin';

export { applicableSlashCommandIds, confirmSlashCommand, createSlashPlugin, filterSlashCommands, reduceSlashState, setBlockTypeKeepingAnchor, slashPluginKey, SLASH_COMMANDS, INACTIVE_SLASH_STATE } from './slash-plugin';
export type { SlashAction, SlashCommand, SlashPluginOptions, SlashState } from './slash-plugin';

export { isInsideCodeBlock, matchTrigger } from './trigger';
export type { TriggerMatch } from './trigger';

export { buildInputRules } from './input-rules';

export { buildEditorPlugins, DROP_CURSOR_CLASS } from './plugins';
export type { BuildEditorPluginsOptions } from './plugins';

export { BLOCK_COMMANDS_NOT_TURNABLE, deleteBlock, duplicateBlock, moveBlockDown, moveBlockUp, topLevelBlock, turnInto, withoutAnchors } from './block-commands';
export type { TopLevelBlock } from './block-commands';

export { blockAt, createBlockDragHooks } from './block-drag';
export type { BlockDragHooks, BlockHit, BlockRect, DragTransfer, DragView } from './block-drag';

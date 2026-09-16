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

export { createEditorCommands, describeUpdate } from './editor-commands';
export type { CommandTarget, EditorCommands, EditorUpdate } from './editor-commands';

export { createMentionPlugin, insertMention, mentionPluginKey, moveSelection, reduceMentionState, INACTIVE_MENTION_STATE } from './mention-plugin';
export type { MentionAction, MentionCandidate, MentionPluginOptions, MentionState } from './mention-plugin';

export { applicableSlashCommandIds, confirmSlashCommand, createSlashPlugin, filterSlashCommands, reduceSlashState, slashPluginKey, SLASH_COMMANDS, INACTIVE_SLASH_STATE } from './slash-plugin';
export type { SlashAction, SlashCommand, SlashPluginOptions, SlashState } from './slash-plugin';

export { isInsideCodeBlock, matchTrigger } from './trigger';
export type { TriggerMatch } from './trigger';

export { buildInputRules } from './input-rules';

export { buildEditorPlugins, DROP_CURSOR_CLASS } from './plugins';
export type { BuildEditorPluginsOptions } from './plugins';

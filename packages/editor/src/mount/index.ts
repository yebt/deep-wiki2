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
export { createEditorView } from './create-editor-view';
export type { CreateEditorViewOptions } from './create-editor-view';

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

export { createMentionPlugin, insertMention, mentionPluginKey, moveSelection, reduceMentionState, INACTIVE_MENTION_STATE } from './mention-plugin';
export type { MentionAction, MentionCandidate, MentionPluginOptions, MentionState } from './mention-plugin';

export { applicableSlashCommandIds, confirmSlashCommand, createSlashPlugin, filterSlashCommands, reduceSlashState, slashPluginKey, SLASH_COMMANDS, INACTIVE_SLASH_STATE } from './slash-plugin';
export type { SlashAction, SlashCommand, SlashPluginOptions, SlashState } from './slash-plugin';

export { isInsideCodeBlock, matchTrigger } from './trigger';
export type { TriggerMatch } from './trigger';

export { buildInputRules } from './input-rules';

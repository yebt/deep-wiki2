/**
 * The `"."` export (design.md "Read mode never reaches the ProseMirror
 * bundle", layer 1). Its transitive dependency closure is
 * `@deep-wiki/markdown` plus `prosemirror-model` only — the pure schema
 * and data model, never `prosemirror-view`/`-keymap`/`-commands`/`-history`
 * or Milkdown. Those live only behind `"./mount"` (WU-16), which this file
 * MUST never re-export.
 */
export { schema } from './schema';
export { classify } from './classify';
export type { Classification } from './classify';
export { fromMarkdown, UnsupportedConstructError } from './from-markdown';
export { toMarkdown } from './to-markdown';
export { probe } from './probe';
export type { ProbeResult } from './probe';
export { roundTrip } from './round-trip';

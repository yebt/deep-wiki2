/**
 * Pure data shapes shared by both the `"."` export and `"./mount"`
 * (design.md "Read mode never reaches the ProseMirror bundle", layer 1).
 * Zero imports, on purpose: `apps/web`'s edit route needs these types to
 * render the mention/slash menus, but MUST NOT statically import
 * `@deep-wiki/editor/mount` even for a type-only import —
 * `scripts/checks/bundle-isolation.ts`'s eager-mount-import check does
 * not distinguish `import` from `import type` (the same reasoning
 * `core-purity.ts` already applies to `packages/core`: whether a
 * structural scan elides type-only specifiers cannot be settled by
 * reading the check, so this project does not rely on it either way).
 * Re-exported from `"."` here — a file with no imports at all trivially
 * satisfies layer 1's "no DOM, no Milkdown, no ProseMirror-view"
 * requirement.
 */

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

/** The slash menu's own render-facing shape — no `run` function, so apps/web can hold this without ever importing anything from `"./mount"`. */
export interface SlashCommandSummary {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface SlashState {
  readonly active: boolean;
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly commands: readonly SlashCommandSummary[];
  readonly selectedIndex: number;
}

/**
 * The Milkdown editing surface (design.md "Read mode never reaches the
 * ProseMirror bundle", layer 1 — the `"./mount"` export). Deliberately
 * empty until WU-16 wires in Milkdown: no Milkdown dependency is installed
 * before then, so the read/edit sequencing constraint
 * (tasks.md "GATE-2 — binding sequencing") is enforced by the dependency
 * graph itself, not only by intent. `packages/editor/src/index.ts` (the
 * `"."` export) must never re-export anything from this module.
 */
export {};

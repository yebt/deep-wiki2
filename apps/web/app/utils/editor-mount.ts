/**
 * The one place apps/web imports `@deep-wiki/editor/mount` — dynamically,
 * as `scripts/checks/bundle-isolation.ts` requires of every file here,
 * and once.
 *
 * Why a shared importer rather than the `import()` `EditorSurface` used
 * to make for itself: measured on 2026-09-16 (docs/TODO.md Findings,
 * "edit-mode latency"), the edit screen's open ran as a chain —
 * hydration, then `GET /pages/:id/edit-session`, then `EditorSurface`
 * mounting, then `import('@deep-wiki/editor/mount')` (dev: 14 requests,
 * 1.04 MB, 230–530 ms), then the first `fromMarkdown` (98 ms, lazy
 * processor init), then the view. The chunk and the session request do
 * not depend on each other, so the route now starts this before it asks
 * for the session (`pages/pages/[id]/edit.vue`), the read screen starts
 * it on pointer intent towards "Edit" (`pages/pages/[id]/index.vue`), and
 * `EditorSurface` awaits whichever of those already ran. The parser is
 * warmed inside the same promise so its first-call cost is paid while
 * the session is still in flight, never after it.
 *
 * A rejected import is dropped from the cache: a chunk that failed to
 * fetch on one hover must not poison the click that follows.
 */
export type EditorMountModule = typeof import('@deep-wiki/editor/mount');

export type EditorMountImporter = () => Promise<EditorMountModule>;

/** Builds a loader around `importer`; exported so the test can drive it with a fake `import()`. */
export function createEditorMountLoader(importer: EditorMountImporter): () => Promise<EditorMountModule> {
  let pending: Promise<EditorMountModule> | undefined;
  return () => {
    pending ??= importer().then(
      (mod) => {
        // Pays the lazy processor initialisation now, off the critical
        // path; `fromMarkdown('')` is the cheapest document that does it.
        mod.fromMarkdown('');
        return mod;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
}

/** Loads (once) and returns the `"./mount"` module. Safe to call early and often. */
export const loadEditorMount = createEditorMountLoader(() => import('@deep-wiki/editor/mount'));

/**
 * Which region the workspace frame's sidebar shows for the current screen.
 *
 * - `tree` — the workspace's furniture: the navigation tree with its
 *   toolbar, always at hand and never a destination (apps/web/PRODUCT.md).
 *   Every screen that names nothing gets this.
 * - `management` — everything that is management: the doors to the
 *   workspace's members and settings, the instance's, and the person's
 *   own. A settings area that keeps the tree beside it is a room whose
 *   furniture has nothing to do with what the person came to do (owner
 *   review, 2026-09-16 — "in a settings area the sidebar should switch to
 *   everything that is management, not stay on the tree").
 *
 * One mechanism, typed: a screen declares `definePageMeta({ sidebar:
 * 'management' })`, and `WorkspaceFrame` reads it from the route. The
 * frame is mounted once and the router swaps the page beneath it
 * (`layouts/workspace.vue`), so the sidebar's region follows the route
 * without either screen knowing about the other, and without the pane
 * being rebuilt.
 */
export type SidebarMode = 'tree' | 'management';

declare module '#app' {
  interface PageMeta {
    /** The sidebar region this screen wants beside it; `tree` when absent. */
    sidebar?: SidebarMode;
  }
}

export function useSidebarMode(): ComputedRef<SidebarMode> {
  const route = useRoute();
  // `meta` is optional here only because a screen test's route mock often
  // carries `params` alone; a route that names no sidebar, mocked or real,
  // gets the tree either way.
  return computed(() => (route.meta as typeof route.meta | undefined)?.sidebar ?? 'tree');
}

<script setup lang="ts">
/**
 * The workspace frame: the room a screen stands in. A persistent
 * **sidebar** on the left — the workspace's tree, its switcher and its
 * doors (`WorkspaceSidebar`) — and, to its right, the room for the
 * content pane the screen brings (`AppShell`'s `UDashboardPanel`, with
 * the contextual bar above the column).
 *
 * The frame stands on the workspace the person is in
 * (`useCurrentWorkspace`): a person lives in one workspace at a time
 * (apps/web/PRODUCT.md), and every screen inside it has already named it
 * or is still learning it from a response. What the frame cannot know is
 * which node the screen is about, so that is a prop: the sidebar marks the
 * row and unfolds to it.
 *
 * `layouts/workspace.vue` mounts this **once**, so the sidebar's DOM —
 * and with it the tree's scroll position — survives every navigation
 * between screens that opt in. `AppShell` mounts it per route around a
 * screen that has not opted in yet; both are the same component so the
 * frame cannot drift between the two (docs/UI-CHECKLIST.md §4.1).
 *
 * `UDashboardGroup` is the library's shell (docs/DESIGN-SYSTEM.md §8.3):
 * `fixed inset-0`, so the frame is the viewport and only the content pane
 * scrolls (§6); `unit="rem"` so the sidebar's width and its focus-mode
 * collapse persist in one cookie per user (§6, "resizable, persisted").
 */
defineProps<{
  /** The node the screen is about, for the tree's current row. */
  nodeId: string | null;
}>();

const { workspaceId } = useCurrentWorkspace();
/** The sidebar's region for the current screen — the tree, or everything that is management (`definePageMeta({ sidebar })`). */
const sidebarMode = useSidebarMode();
// Hydrates with the workspace the server rendered the sidebar with, then
// stands on the live one — see `useSidebarWorkspace`'s note.
const sidebarWorkspaceId = useSidebarWorkspace(workspaceId);

/**
 * Moves focus to the content pane's top bar, so the next Tab lands on
 * this screen's first control — the breadcrumb, then its actions — rather
 * than on the sidebar's. The bar, not the column: the bar precedes the
 * column in the DOM, and a Tab from the column would skip it.
 */
function skipToContent(): void {
  // By id rather than a template ref: `UDashboardNavbar` renders a fragment,
  // so its `$el` is not the bar — and the bar belongs to the screen, not
  // to this frame.
  document.getElementById('content-bar')?.focus();
}
</script>

<template>
  <UDashboardGroup unit="rem" storage="cookie" storage-key="dw-frame">
    <!-- The sidebar precedes the content in reading order, so a keyboard
         user would otherwise cross the switcher, the toolbar, the tree
         and the doors before reaching this screen's own actions. The
         first tab stop in the frame jumps past all of it (checklist §5). -->
    <a
      href="#content-bar"
      class="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-inverted focus:px-3 focus:py-2 focus:text-label-large focus:text-inverted"
      @click.prevent="skipToContent"
    >
      Skip to content
    </a>
    <WorkspaceSidebar :workspace-id="sidebarWorkspaceId" :current-node-id="nodeId" :mode="sidebarMode" />
    <slot />
  </UDashboardGroup>
</template>

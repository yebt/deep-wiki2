<script setup lang="ts">
/**
 * The left pane of the workspace frame: the room's name at the top, its
 * furniture in the middle, its doors at the bottom.
 *
 * - **Top**: `WorkspaceSwitcher` — small and deliberate, because the
 *   person is *in* this workspace and leaves it rarely (PRODUCT.md).
 * - **Middle**: `NavigationTree`, always at hand and never a destination
 *   — the create/rename toolbar, then the tree, scrolling inside the pane.
 * - **Bottom**: the workspace-level doors. Members, for those who manage
 *   (rendered for every caller: no `manage` signal reaches the client yet,
 *   see docs/TODO.md); the operator's Registration entry, for the same
 *   reason; and the theme toggle, where Obsidian and Notion keep such
 *   things — quietly, out of the content's way. There is no sign-out here
 *   because the product has no sign-out yet (PRODUCT.md, "Not yet"); a
 *   control that does nothing is worse than an absent one (§6).
 *
 * `UDashboardSidebar` is the library's pane (docs/DESIGN-SYSTEM.md §8.3):
 * persistent from `lg` up, a focus-trapped `USlideover` below it that
 * closes on navigation and on Escape (checklist §6), resizable with the
 * width persisted per user (§6, "panel widths are resizable where it
 * matters and the choice persists"). Its tone is `bg-elevated` — the
 * navigation pane's rung (§1.4) — separated from the document pane by tone
 * and a hairline, never a shadow (§4.3).
 *
 * `--ui-header-height` is 56px (§7.2); the header slot takes it so the
 * switcher lines up with the content pane's top bar beside it.
 *
 * **Focus mode.** `collapsible`, bound to `useFocusMode`: the control in
 * the content pane's bar (`SidebarToggle`) and `Ctrl`/`⌘`+`\` hide the
 * pane — to nothing, not to a rail. Nuxt UI's collapse leaves a `min-w-16`
 * rail, so the root is hidden outright from `lg` up while collapsed, and
 * the resize handle goes with it: a handle beside nothing is a control
 * that does nothing (§6). The library persists the collapse in the same
 * cookie as the width (`dw-frame-sidebar-workspace`) and reads it back
 * before the first render, so a person who chose the document alone gets
 * it on the next visit without a flash. Below `lg` the collapse has no
 * effect: the sidebar is a drawer there either way.
 */
defineProps<{
  workspaceId: string | null;
  currentNodeId?: string | null;
}>();

const { collapsed } = useFocusMode();

/** `UDashboardSidebar`'s own id for the pane: the group's storage key, then the `id` prop below. */
const SIDEBAR_ELEMENT_ID = 'dw-frame-sidebar-workspace';
</script>

<template>
  <UDashboardSidebar
    id="workspace"
    v-model:collapsed="collapsed"
    role="navigation"
    aria-label="Workspace"
    resizable
    collapsible
    :collapsed-size="0"
    :default-size="17.5"
    :min-size="14"
    :max-size="28"
    :ui="{
      root: 'bg-elevated lg:data-[collapsed=true]:hidden',
      header: 'px-2 border-b border-default',
      body: 'px-2 py-2 gap-2',
      footer: 'px-2 py-2 gap-1 border-t border-default',
      content: 'bg-elevated',
    }"
  >
    <template #header>
      <WorkspaceSwitcher :workspace-id="workspaceId" />
    </template>

    <!-- Hidden with the pane rather than removed: a slot that renders
         nothing makes Vue fall back to the library's own handle. -->
    <template #resize-handle="{ onMouseDown, onTouchStart, onDoubleClick }">
      <UDashboardResizeHandle
        :class="collapsed ? 'lg:hidden' : undefined"
        :aria-controls="SIDEBAR_ELEMENT_ID"
        @mousedown="onMouseDown"
        @touchstart="onTouchStart"
        @dblclick="onDoubleClick"
      />
    </template>

    <NavigationTree v-if="workspaceId" :workspace-id="workspaceId" :current-node-id="currentNodeId" />
    <!-- No workspace yet: a real state with a way forward, in the
         product's words, rather than an empty pane (checklist §3). -->
    <div v-else data-testid="sidebar-no-workspace" class="space-y-3 px-2 py-2">
      <p class="text-body-medium text-muted">Pick a workspace from the menu above to see its shelves, books, chapters and pages.</p>
      <UButton to="/workspaces" size="sm" variant="outline" color="neutral" icon="i-lucide-list">All workspaces</UButton>
    </div>

    <template #footer>
      <!-- Every control here is §7.2's 32px chrome height. Members keeps
           its label: it is a door people open. The two icon-only controls
           carry a name and a tooltip both (§4.3). -->
      <UButton
        v-if="workspaceId"
        :to="`/workspaces/${workspaceId}/members`"
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-lucide-users"
      >
        Members
      </UButton>
      <span class="ms-auto flex items-center gap-1">
        <UTooltip text="Registration settings">
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-shield" square aria-label="Registration settings" to="/admin/registration" />
        </UTooltip>
        <UTooltip text="Toggle color theme">
          <UColorModeButton size="sm" aria-label="Toggle color theme" />
        </UTooltip>
      </span>
    </template>
  </UDashboardSidebar>
</template>

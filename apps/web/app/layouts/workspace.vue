<script setup lang="ts">
/**
 * The layout of every screen inside a workspace, opted into with
 * `definePageMeta({ layout: 'workspace' })`.
 *
 * Nuxt mounts a layout once and swaps the page beneath it. That is the
 * point: the frame — the sidebar with the tree, the skip link — is built
 * once per session, and a navigation from the dashboard to a page, or
 * from one page to the next, replaces only the content pane. The tree
 * keeps its scroll position, its DOM and any drag in progress; before
 * this layout every route mounted its own frame and the sidebar was
 * rebuilt on each click (docs/TODO.md Findings, 2026-09-15).
 *
 * The page inside still renders `AppShell`: it finds this frame through
 * `useWorkspaceFrame` and renders only its content pane — the contextual
 * bar and the column — and hands the frame the node it is about, so the
 * sidebar can mark the row. A screen that has not opted in yet gets the
 * same `WorkspaceFrame` from `AppShell` per route, unchanged in what it
 * shows; only what persists differs.
 *
 * There is deliberately no `layouts/default.vue`: a page that names no
 * layout — sign-in and its family, the workspace list, the error screen —
 * renders bare, which is what Nuxt does for a missing default, and a
 * wrapper element there would be one more uncounted box around the
 * document frame's `min-h-svh` column (the 2026-09-04 review's 49px).
 */
const frame = provideWorkspaceFrame();
</script>

<template>
  <WorkspaceFrame :node-id="frame.nodeId.value">
    <slot />
  </WorkspaceFrame>
</template>

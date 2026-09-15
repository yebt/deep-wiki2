<script setup lang="ts">
/**
 * The application chrome — the one component every route renders inside,
 * and the only place a header, a sidebar, a footer or a content column is
 * declared. It exists because the chrome was previously written three
 * times and the copies drifted (docs/UI-CHECKLIST.md §4.1); it now has two
 * frames, chosen by whether the screen is *inside a workspace*.
 *
 * ── The workspace frame ──────────────────────────────────────────────
 *
 * A person lives inside one workspace at a time, the way a person lives
 * inside one Obsidian vault (apps/web/PRODUCT.md). So once inside one, the
 * frame is: a persistent **sidebar** on the left carrying the workspace's
 * tree, its switcher and its doors (`WorkspaceSidebar`); a **content pane**
 * on the right where every route renders; and, inside that pane, a
 * **contextual top bar** — the breadcrumb of where the person is (shelf ›
 * book › chapter › page) and the actions that belong to *this* screen,
 * through the `header-end` slot. Not a global bar that accumulates links:
 * the previous one held "Book history: A B C" wrapping onto two lines.
 * Below `lg` the sidebar is a drawer opened from the top bar and the
 * content takes the width (§6). The `UDashboard*` set is the library's
 * own shell for exactly this (docs/DESIGN-SYSTEM.md §8.3).
 *
 * The screen names its workspace: `workspace-id` as a string is "I am in
 * this workspace"; `null` is "I am in one but have not learned which yet"
 * (read mode learns it from the page response), in which case the frame
 * stands on the last workspace the person was in, from `useCurrentWorkspace`.
 * Leaving the prop out is "I am not inside a workspace" — the auth
 * screens, the workspace list, the error screen — and selects the other
 * frame. `node-id` places the breadcrumb through the tree the sidebar
 * already holds; `trail` appends what the tree cannot know ("History").
 *
 * ── The document frame ───────────────────────────────────────────────
 *
 * The frame the product had before 2026-09-15, unchanged: a full-height
 * column, the top app bar with the brand and the theme toggle, `UMain`,
 * a footer. Height: `min-h-svh` plus `flex-1` on `UMain`, whose own base
 * (viewport minus the header, no allowance for a footer) is replaced
 * centrally in `app.config.ts`. Width: the shell's, for the same reason
 * it owns the height — five screens once wrote their own column and it
 * drifted to 658.9px at x=32 with 589px of empty page beside it.
 *
 * ── The content column, in both frames ──────────────────────────────
 *
 *   `measure`  72ch (§2.4), centred — the reading measure, which checklist
 *              §4.4 requires to land at 65-80 characters. Prose takes it
 *              by definition; edit mode takes the same column so switching
 *              modes never moves the text under the cursor. In the
 *              workspace frame the column is centred *in the content
 *              pane*, beside the sidebar, not in the middle of nothing.
 *   `narrow`   `max-w-md` — one card holding a short form (the auth screens).
 *   `wide`     the pane's whole width — a grid of panels, the dashboard.
 *
 * `center` adds `my-auto`, which only absorbs *positive* free space, so a
 * block taller than the region stays top-aligned and fully reachable.
 */
import type { BreadcrumbItem } from '@nuxt/ui';

const props = withDefaults(
  defineProps<{
    column?: 'narrow' | 'measure' | 'wide';
    center?: boolean;
    /** Inside a workspace: its id, or `null` while the screen is still learning it. Omit outside a workspace. */
    workspaceId?: string | null;
    /** The node the screen is about, for the breadcrumb. */
    nodeId?: string | null;
    /** Crumbs after the node the tree can place — "History", "Editing". */
    trail?: readonly BreadcrumbItem[];
    /** What the last crumb says when the tree cannot place `nodeId` yet — the screen's own name for itself. */
    title?: string;
  }>(),
  { column: 'measure', center: false, workspaceId: undefined, nodeId: null, trail: () => [], title: undefined },
);

const COLUMNS = {
  narrow: 'mx-auto w-full max-w-md',
  measure: 'mx-auto w-full max-w-measure',
  wide: 'w-full',
} as const;

const columnClass = computed(() => COLUMNS[props.column]);

/** The frame is the workspace's whenever the screen says it stands inside one, known or not yet. */
const inWorkspace = computed(() => props.workspaceId !== undefined);

const current = useCurrentWorkspace();
watch(
  () => props.workspaceId,
  (id) => {
    if (id) current.enter(id);
  },
  { immediate: true },
);

/** The workspace the frame stands on: the screen's, or the last one the person was in. */
const frameWorkspaceId = computed(() => props.workspaceId ?? current.workspaceId.value);

const directory = useWorkspaceDirectory();
const tree = useWorkspaceTree(frameWorkspaceId);

/**
 * Moves focus to the content pane's top bar, so the next Tab lands on
 * this screen's first control — the breadcrumb, then its actions — rather
 * than on the sidebar's. The bar, not the column: the bar precedes the
 * column in the DOM, and a Tab from the column would skip it.
 */
function skipToContent(): void {
  // By id rather than a template ref: `UDashboardNavbar` renders a fragment,
  // so its `$el` is not the bar.
  document.getElementById('content-bar')?.focus();
}

const crumbs = computed<BreadcrumbItem[]>(() => {
  const items: BreadcrumbItem[] = [];
  const workspaceId = frameWorkspaceId.value;
  if (workspaceId) {
    items.push({ label: directory.nameOf(workspaceId) ?? 'Workspace', icon: 'i-lucide-library-big', to: `/workspaces/${workspaceId}` });
  }
  const path = props.nodeId ? tree.pathTo(props.nodeId) : [];
  if (path.length > 0) {
    // A shelf, book or chapter has no screen of its own this batch, so it
    // is a place name, not a link; the page is.
    for (const node of path) items.push(node.type === 'page' ? { label: node.title, to: `/pages/${node.id}` } : { label: node.title });
  } else if (props.title) {
    items.push({ label: props.title });
  }
  items.push(...props.trail);
  return items;
});
</script>

<template>
  <!-- `fixed inset-0`: the frame is the viewport, and the content pane
       scrolls inside it — so the page body never scrolls (§6) and the
       sidebar stays where a hand can reach it. -->
  <UDashboardGroup v-if="inWorkspace" unit="rem" storage="cookie" storage-key="dw-frame">
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
    <WorkspaceSidebar :workspace-id="frameWorkspaceId" :current-node-id="nodeId" />

    <UDashboardPanel id="content" :ui="{ root: 'bg-default', body: 'p-4 sm:p-6 lg:px-10' }">
      <template #header>
        <!-- The contextual top bar: `bg-elevated`, a hairline, no shadow
             (§9.3, §4.3). The toggle it renders below `lg` opens the
             drawer. The breadcrumb is where the person is; the `right`
             slot is what this screen can do. -->
        <UDashboardNavbar id="content-bar" as="header" tabindex="-1" class="outline-none" :ui="{ root: 'bg-elevated', left: 'flex-1' }">
          <template #left>
            <UBreadcrumb :items="crumbs" :ui="{ link: 'text-label-large', root: 'min-w-0 flex-1' }" aria-label="Where you are" />
          </template>
          <template #right>
            <slot name="header-end" />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <!-- The one `main` landmark (§5) is the column itself. -->
        <main id="content-main" :class="[columnClass, center ? 'my-auto' : undefined]">
          <slot />
        </main>
      </template>
    </UDashboardPanel>
  </UDashboardGroup>

  <div v-else class="flex min-h-svh flex-col">
    <!-- `:toggle="false"`: `UHeader` renders a hamburger that opens a
         mobile menu built from its `#body` slot, which no route outside a
         workspace fills — a control that looks clickable and does nothing
         (docs/UI-CHECKLIST.md §6, observable breakage). -->
    <UHeader :toggle="false">
      <template #left>
        <!-- The brand is the way back from any screen, so it is a link
             rather than a label — and an interactive element carries a
             state layer like every other one (docs/DESIGN-SYSTEM.md §5.2). -->
        <NuxtLink to="/" class="dw-state-layer -mx-2 flex items-center gap-2 rounded-md px-2 py-1">
          <UIcon name="i-lucide-library-big" class="size-5 text-primary" aria-hidden="true" />
          <span class="text-title-large text-highlighted">deep-wiki</span>
        </NuxtLink>
      </template>
      <template #right>
        <slot name="header-end" />
        <!-- `/admin/registration`, reachable from the chrome so the Super
             Root can get there from anywhere. Rendered for every caller —
             no `is_super_root` signal reaches the client (docs/TODO.md) —
             and the screen's own "This is the instance operator's" state is
             what gates a non-operator. Inside a workspace the same door
             stands in the sidebar's footer. -->
        <UTooltip text="Registration settings">
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-shield" square aria-label="Registration settings" to="/admin/registration" />
        </UTooltip>
        <UTooltip text="Toggle color theme">
          <UColorModeButton size="sm" aria-label="Toggle color theme" />
        </UTooltip>
      </template>
    </UHeader>

    <UMain>
      <UContainer class="py-10 sm:py-16" :class="center ? 'my-auto' : undefined">
        <div :class="columnClass">
          <slot />
        </div>
      </UContainer>
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-body-small text-muted">deep-wiki</p>
      </template>
      <template #right>
        <p class="text-body-small text-muted">Material Design 3 · Nuxt UI v4</p>
      </template>
    </UFooter>
  </div>
</template>

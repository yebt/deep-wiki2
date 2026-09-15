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
 * tree, its switcher and its doors (`WorkspaceFrame` → `WorkspaceSidebar`);
 * a **content pane** on the right where every route renders; and, inside
 * that pane, a **contextual top bar** — the sidebar's own toggle, the
 * breadcrumb of where the person is (shelf › book › chapter › page) and
 * the actions that belong to *this* screen, through the `header-end`
 * slot. Not a global bar that accumulates links: the previous one held
 * "Book history: A B C" wrapping onto two lines. Below `lg` the sidebar
 * is a drawer opened from the top bar and the content takes the width
 * (§6). The `UDashboard*` set is the library's own shell for exactly this
 * (docs/DESIGN-SYSTEM.md §8.3).
 *
 * **Who mounts the frame.** A screen that opts into `layouts/workspace.vue`
 * (`definePageMeta({ layout: 'workspace' })`) stands inside a frame the
 * layout mounted once, and this component renders only the pane — the bar
 * and the column — and hands the layout the node it is about through
 * `useWorkspaceFrame`. That is what keeps the sidebar's DOM, and the
 * tree's scroll position, across a navigation. A screen that has not
 * opted in yet gets the same `WorkspaceFrame` here, per route: the same
 * component, so nothing about it can differ (docs/UI-CHECKLIST.md §4.1);
 * only what persists does. Both take the same props and fill the same
 * slots, so opting in is one line in the screen.
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
import WorkspaceFrame from './WorkspaceFrame.vue';

/**
 * Renders its children and nothing else. Inside the workspace layout the
 * frame already stands around this screen, so the pane needs no wrapper —
 * and one template, wrapped or not, is better than the pane written twice.
 */
const PaneWithoutFrame = defineComponent({
  name: 'PaneWithoutFrame',
  inheritAttrs: false,
  setup: (_, { slots }) => () => slots.default?.(),
});

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

/**
 * The frame the layout mounted around this screen, or `null` when the
 * screen has not opted into the layout and this component stands the
 * frame up itself. Set on mount and on change, never cleared on unmount:
 * during a navigation the next screen's shell sets its node before this
 * one is torn down, and a clear here would erase it.
 */
const layoutFrame = useWorkspaceFrame();
watch(
  () => props.nodeId,
  (nodeId) => layoutFrame?.setNodeId(nodeId ?? null),
  { immediate: true },
);

/** The workspace the frame stands on: the screen's, or the last one the person was in. */
const frameWorkspaceId = computed(() => props.workspaceId ?? current.workspaceId.value);

const directory = useWorkspaceDirectory();
const tree = useWorkspaceTree(frameWorkspaceId);

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
  <!-- Inside `layouts/workspace.vue` the frame already stands around this
       screen and only the pane is rendered; otherwise the frame is stood
       up here, per route, from the same component. -->
  <component :is="layoutFrame ? PaneWithoutFrame : WorkspaceFrame" v-if="inWorkspace" :node-id="nodeId ?? null">
    <UDashboardPanel id="content" :ui="{ root: 'bg-default', body: 'p-4 sm:p-6 lg:px-10' }">
      <template #header>
        <!-- The contextual top bar: `bg-elevated`, a hairline, no shadow
             (§9.3, §4.3). At the sidebar's edge, the sidebar's control:
             the drawer toggle the bar renders itself below `lg`, and
             focus mode's `SidebarToggle` from `lg` up. Then the
             breadcrumb — where the person is — and, in the `right` slot,
             what this screen can do. -->
        <UDashboardNavbar id="content-bar" as="header" tabindex="-1" class="outline-none" :ui="{ root: 'bg-elevated', left: 'flex-1' }">
          <template #left>
            <SidebarToggle />
            <!-- Below `sm` only the last crumb shows — at 320 the bar
                 also holds the drawer toggle and this screen's controls,
                 and the workspace crumb rendered as "E." — while the rest
                 stay for assistive technology. The workspace is one tap
                 away in the drawer. -->
            <UBreadcrumb
              :items="crumbs"
              :ui="{
                link: 'text-label-large',
                root: 'min-w-0 flex-1',
                item: 'max-sm:sr-only max-sm:last:not-sr-only',
                separator: 'max-sm:hidden',
              }"
              aria-label="Where you are"
            />
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
  </component>

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

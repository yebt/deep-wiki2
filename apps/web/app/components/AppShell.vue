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
 * ── The address, held to its word ────────────────────────────────────
 *
 * Since 2026-09-17 every address inside a workspace carries the
 * workspace's slug (`/w/<slug>/p/<id>`, `utils/routes.ts`), so a screen
 * inside one has two names for where it is: the slug in the address and
 * the id its response names. This component is where the two are
 * reconciled, once, for every screen:
 *
 * - **A node screen** (`node-id` set, `/w/<slug>/p|b/<id>`) says where
 *   its node lives from its own response (`location`, a `NodeLocation`:
 *   the six node responses name their workspace by id and slug), and
 *   the shell asks nothing more; a screen that cannot say leaves the
 *   prop out and the shell asks `useNodeLocation` beside the read, one
 *   request more. A located node whose workspace slug is not the
 *   address's is **not found** — the pane shows the not-found notice in
 *   place of the screen, the frame does not stand on the node's real
 *   workspace, and nothing says which half of the address was wrong
 *   (docs/UI-CHECKLIST.md §3, no oracle). A node the API will not locate
 *   is left to the screen's own answer: it has a more honest one for a
 *   direct request (`usePageRead` tells denial from absence).
 * - **A workspace screen** (`/w/<slug>`, `/members`) asked its API by the
 *   slug and got the id back; it passes both, and the pair is entered.
 * - The slug an entered workspace is remembered under comes from the
 *   screen, the location or the directory — never from a guess.
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
 *
 * ── The condensed bar ────────────────────────────────────────────────
 *
 * `condensed` is for a screen where the document must outrank the chrome
 * — edit mode. The owner's words on 2026-09-16: "the top part is too
 * much; the document loses importance." The full breadcrumb —
 * workspace › shelf › book › chapter › page › Editing — restates the
 * path the sidebar's tree already shows beside the document
 * (apps/web/PRODUCT.md, principle 1: the tree is the furniture, always at
 * hand), so in the condensed bar the breadcrumb keeps its last two crumbs
 * — the page and the state — and folds the rest into one overflow
 * control, `…`, a menu that reveals them: the workspace as the link it
 * was, the shelf, book and chapter as the place names they were.
 * `UBreadcrumb` in the installed Nuxt UI (4.11) has no overflow of its
 * own, so the fold is composed from its item slot and `UDropdownMenu`,
 * not a second breadcrumb. The bar's height does not change: the column
 * starts where it starts on every other screen, which
 * `e2e/editor.spec.ts` measures against read mode.
 */
import type { BreadcrumbItem, DropdownMenuItem } from '@nuxt/ui';
import type { NodeWorkspace } from '@deep-wiki/contracts';
import type { NodeLocation } from '~/composables/useNodeLocation';
import { pageUrl, registrationSettingsUrl, workspaceUrl, workspacesUrl } from '~/utils/routes';
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
    /** The workspace's slug, when the screen's response named it beside the id (the dashboard, members). */
    workspaceSlug?: string | null;
    /** The node the screen is about, for the breadcrumb. */
    nodeId?: string | null;
    /** Where that node lives, as the screen's own response says (`NodeLocation`). Leave out for a screen whose response cannot say, and the shell asks `useNodeLocation` itself. */
    location?: NodeLocation;
    /** Crumbs after the node the tree can place — "History", "Editing". */
    trail?: readonly BreadcrumbItem[];
    /** What the last crumb says when the tree cannot place `nodeId` yet — the screen's own name for itself. */
    title?: string;
    /** The lighter bar: the breadcrumb keeps its last two crumbs and folds the rest into an overflow menu. Edit mode. */
    condensed?: boolean;
  }>(),
  { column: 'measure', center: false, workspaceId: undefined, workspaceSlug: null, nodeId: null, location: undefined, trail: () => [], title: undefined, condensed: false },
);

const COLUMNS = {
  narrow: 'mx-auto w-full max-w-md',
  measure: 'mx-auto w-full max-w-measure',
  wide: 'w-full',
} as const;

const columnClass = computed(() => COLUMNS[props.column]);

/** The frame is the workspace's whenever the screen says it stands inside one, known or not yet. */
const inWorkspace = computed(() => props.workspaceId !== undefined);

const route = useRoute();
/** The workspace slug the address carries (`/w/<slug>/…`), or `null` on an address outside the family. */
const routeSlug = computed(() => {
  const slug = (route.params as Record<string, unknown> | undefined)?.workspace;
  return typeof slug === 'string' && slug.length > 0 ? slug : null;
});

const current = useCurrentWorkspace();
const directory = useWorkspaceDirectory();

/**
 * Where the screen's node lives. Only a screen about a node on an address
 * that names a workspace has anything to reconcile; it says so itself
 * through `location` when its response names the workspace, and only a
 * screen that cannot has the shell ask `useNodeLocation` beside its read
 * (a screen's prop is fixed at setup, as `workspace-id`'s presence is).
 */
const asksLocation = props.location === undefined;
const asked = useNodeLocation(asksLocation && inWorkspace.value && routeSlug.value ? (props.nodeId ?? null) : null);
onMounted(() => {
  void asked.load();
});

/** The node's workspace, by id and slug, once either source has it; `null` before, and for a node neither will locate. */
const located = computed<NodeWorkspace | null>(() => {
  if (!asksLocation) return props.location?.state === 'located' ? props.location.workspace : null;
  const answer = asked.location.value;
  return answer ? { id: answer.workspaceId, slug: answer.workspaceSlug } : null;
});

/**
 * Whether the address's two names disagree: the node is located, and its
 * workspace's slug is not the one in the address. A location the API
 * refused is not a verdict — the screen answers that itself.
 */
const scopeMismatch = computed(() => located.value !== null && routeSlug.value !== null && located.value.slug !== routeSlug.value);

/**
 * The workspace the frame stands on, by id: the screen's own, unless the
 * address disagrees with it — then the address's, so the sidebar never
 * stands on a workspace the address did not name — and, until either is
 * known, the last one the person was in.
 */
const frameWorkspaceId = computed(() => {
  if (scopeMismatch.value) return (routeSlug.value ? directory.idOf(routeSlug.value) : null) ?? current.workspaceId.value;
  return props.workspaceId ?? (routeSlug.value ? directory.idOf(routeSlug.value) : null) ?? current.workspaceId.value;
});

/**
 * The same workspace's slug — what every link in the bar is built from.
 * In order of who can vouch for it: the screen's response, when it named
 * both; the located node, whose workspace it is; the directory, for an
 * id it holds; the address, for the screen's own id when nothing
 * disputes it; and the remembered pair, for the remembered workspace.
 * Never a slug for an id nobody paired it with.
 */
const frameWorkspaceSlug = computed(() => {
  const id = frameWorkspaceId.value;
  if (!id) return null;
  if (props.workspaceSlug && props.workspaceId === id) return props.workspaceSlug;
  if (located.value && located.value.id === id) return located.value.slug;
  const known = directory.slugOf(id);
  if (known) return known;
  if (routeSlug.value && props.workspaceId === id && !scopeMismatch.value) return routeSlug.value;
  return current.workspaceId.value === id ? current.workspaceSlug.value : null;
});

/**
 * Whether the address has been checked — or there was nothing to check.
 * A location still in flight is not a verdict either way: on the server
 * this runs at setup, before the prefetch that answers it, and entering
 * on the address's word there would write a pair the answer may dispute
 * into the cookie `/` reopens on.
 */
const scopeSettled = computed(() => (asksLocation ? asked.status.value !== 'loading' : props.location?.state !== 'pending'));

/**
 * Whether the person is *in* the frame's workspace — the screen's response
 * named it, or the address did and the directory confirms it is one they
 * can open (a management screen the API refused still stands in the room
 * the address named). Never the remembered one on its own: a screen that
 * names nothing does not re-enter it.
 */
const frameWorkspaceNamed = computed(() => {
  const id = frameWorkspaceId.value;
  if (!id) return false;
  if (props.workspaceId === id) return true;
  return routeSlug.value !== null && directory.idOf(routeSlug.value) === id;
});

// Entering is what the next screen starts from and what `/` reopens, so it
// waits for both names, for the address to be checked, and never for a
// workspace the address disputes.
watch(
  [frameWorkspaceId, frameWorkspaceSlug, frameWorkspaceNamed, scopeMismatch, scopeSettled],
  ([id, slug, named, mismatch, settled]) => {
    if (id && slug && named && settled && !mismatch) current.enter({ id, slug });
  },
  { immediate: true },
);

/**
 * The frame the layout mounted around this screen, or `null` when the
 * screen has not opted into the layout and this component stands the
 * frame up itself. Set on mount and on change, never cleared on unmount:
 * during a navigation the next screen's shell sets its node before this
 * one is torn down, and a clear here would erase it. A node the address
 * disputes is not handed over: the tree must not mark where it really is.
 */
const layoutFrame = useWorkspaceFrame();
const frameNodeId = computed(() => (scopeMismatch.value ? null : (props.nodeId ?? null)));
watch(frameNodeId, (nodeId) => layoutFrame?.setNodeId(nodeId), { immediate: true });

const tree = useWorkspaceTree(frameWorkspaceId);

const crumbs = computed<BreadcrumbItem[]>(() => {
  const items: BreadcrumbItem[] = [];
  const workspaceId = frameWorkspaceId.value;
  const slug = frameWorkspaceSlug.value;
  if (workspaceId) {
    items.push({
      label: directory.nameOf(workspaceId) ?? 'Workspace',
      icon: 'i-lucide-library-big',
      ...(slug ? { to: workspaceUrl(slug) } : {}),
    });
  }
  if (scopeMismatch.value) {
    items.push({ label: 'Not found' });
    return items;
  }
  const path = props.nodeId ? tree.pathTo(props.nodeId) : [];
  if (path.length > 0) {
    // A shelf, book or chapter has no screen of its own this batch, so it
    // is a place name, not a link; the page is.
    for (const node of path) items.push(node.type === 'page' && slug ? { label: node.title, to: pageUrl(slug, node.id) } : { label: node.title });
  } else if (props.title) {
    items.push({ label: props.title });
  }
  items.push(...props.trail);
  return items;
});

/** Where the not-found notice sends the person: the workspace the address named when it is one they can open, and always the list. */
const notFoundWorkspaceUrl = computed(() => {
  const slug = routeSlug.value;
  return slug && directory.idOf(slug) ? workspaceUrl(slug) : null;
});
const allWorkspacesUrl = workspacesUrl();
const registrationUrl = registrationSettingsUrl();

/** How many crumbs the condensed bar keeps in the row: the page and its state. */
const CONDENSED_TAIL = 2;

/** The crumbs the condensed bar folds away — everything before the tail, when there is anything. */
const foldedCrumbs = computed<BreadcrumbItem[]>(() =>
  props.condensed && crumbs.value.length > CONDENSED_TAIL ? crumbs.value.slice(0, -CONDENSED_TAIL) : [],
);

/**
 * What the breadcrumb draws: the overflow item in place of the folded
 * crumbs, then the tail. Below `sm` the overflow is gone outright
 * (`hidden`, not the `sr-only` the other crumbs take): a focusable control
 * a person cannot see is §6's inaccessible control, and at that width the
 * drawer already holds the whole path.
 */
const rowCrumbs = computed<BreadcrumbItem[]>(() =>
  foldedCrumbs.value.length > 0
    ? [{ slot: 'overflow' as const, ui: { item: 'max-sm:hidden' } }, ...crumbs.value.slice(-CONDENSED_TAIL)]
    : crumbs.value,
);

/** The overflow menu: a folded crumb that was a link stays one; a place name is a label, not a dead item. */
const overflowMenu = computed<DropdownMenuItem[][]>(() => [
  foldedCrumbs.value.map((crumb) =>
    crumb.to ? { label: crumb.label, icon: crumb.icon, to: crumb.to } : { label: crumb.label, type: 'label' as const },
  ),
]);
</script>

<template>
  <!-- Inside `layouts/workspace.vue` the frame already stands around this
       screen and only the pane is rendered; otherwise the frame is stood
       up here, per route, from the same component. -->
  <component :is="layoutFrame ? PaneWithoutFrame : WorkspaceFrame" v-if="inWorkspace" :node-id="frameNodeId">
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
              :items="rowCrumbs"
              :ui="{
                link: 'text-label-large',
                root: 'min-w-0 flex-1',
                item: 'max-sm:sr-only max-sm:last:not-sr-only',
                separator: 'max-sm:hidden',
              }"
              aria-label="Where you are"
            >
              <!-- The condensed bar's overflow: one icon-only control, so
                   both halves of §4.3 — a name and a tooltip — at the bar's
                   32px chrome height (§7.2), holding the folded crumbs. -->
              <template #overflow>
                <UDropdownMenu :items="overflowMenu" :content="{ align: 'start' }">
                  <UTooltip text="Show the full path">
                    <UButton size="sm" variant="ghost" color="neutral" square icon="i-lucide-ellipsis" aria-label="Show the full path" />
                  </UTooltip>
                </UDropdownMenu>
              </template>
            </UBreadcrumb>
          </template>
          <template #right>
            <slot v-if="!scopeMismatch" name="header-end" />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <!-- The one `main` landmark (§5) is the column itself. When the
             address's two names disagree, the notice stands in the reading
             measure in place of the screen — the same column every screen's
             own not-found takes — and says out loud that it does not
             disclose which name was wrong. -->
        <main id="content-main" :class="[scopeMismatch ? COLUMNS.measure : columnClass, center ? 'my-auto' : undefined]">
          <PageNotice v-if="scopeMismatch" icon="i-lucide-file-question" heading="There is nothing at this address" data-testid="scope-not-found">
            The workspace named in the address does not hold what the rest of it names — or it may be somewhere you don't have access to. deep-wiki deliberately doesn't say which, so that a place you can't see is indistinguishable from one that was never there.
            <template #actions>
              <UButton v-if="notFoundWorkspaceUrl" icon="i-lucide-house" variant="solid" color="primary" :to="notFoundWorkspaceUrl">Workspace home</UButton>
              <UButton icon="i-lucide-library-big" :variant="notFoundWorkspaceUrl ? 'outline' : 'solid'" :color="notFoundWorkspaceUrl ? 'neutral' : 'primary'" :to="allWorkspacesUrl">Your workspaces</UButton>
            </template>
          </PageNotice>
          <slot v-else />
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
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-shield" square aria-label="Registration settings" :to="registrationUrl" />
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

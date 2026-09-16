<script setup lang="ts">
/**
 * The navigation tree, housed in the sidebar (navigation-tree spec: only
 * readable nodes, drag-reorder writes back to `position`). Until
 * 2026-09-15 this was a screen of its own — a tree inside a card in the
 * middle of a wide viewport, with a heading that introduced it and a
 * paragraph of keyboard help above it. The tree is not a destination; it
 * is the room's furniture (apps/web/PRODUCT.md, principle 1), so it stands
 * beside every screen and needs no heading to say what it is.
 *
 * What moved here unchanged: the ARIA tree pattern (one tab stop, roving
 * tabindex, arrows, Home/End, Enter/Space, `Alt`+arrows for reorder), the
 * write toolbar above the tree and outside it, and the four states the
 * request can land in. What changed in the housing:
 *
 * - The keyboard help is a `?` tooltip on the tree's header row, and a
 *   screen-reader description on the tree itself, instead of a paragraph.
 * - A book's history is a context action on the book's row — a menu at
 *   the row's end — not a strip of chrome links.
 * - The tree, its fold state and its selection are `useWorkspaceTree`'s,
 *   kept across screens: every route renders its own shell, and a tree
 *   that reloaded on every navigation would never be "at hand".
 * - The row of the page that is open is `aria-current`, and its ancestors
 *   are unfolded when the page opens so the row is on screen.
 * - Writes are drawn before the server answers (2026-09-16): a dropped
 *   row is where it was dropped at once and snaps back only on a refusal,
 *   with the reason beside the tree; a created or renamed row is drawn
 *   from the response that made it, never by asking for the tree again
 *   (`useTree`'s `reorder`, `applyCreated`, `applyRenamed`).
 * - Every row has a context menu (2026-09-16): right-click, the `⋯` at
 *   the row's end, `Shift+F10` and the `ContextMenu` key all open the
 *   one `UContextMenu` wrapped around the tree, whose items are
 *   `treeRowActions()` for the row the event landed on. "New…" and
 *   "Rename…" from it open the toolbar's own dialogs — `NavigationTreeActions`
 *   exposes the two functions its buttons call — so a rename from the
 *   menu and from the toolbar is one code path; "Move up/down" is the
 *   same `reorder` the `Alt`-arrows make. Focus returns to the row when
 *   the menu closes, and a dialog the menu opened is opened *after* that
 *   return, so the dialog's own focus return lands on the row too.
 * - A filter above the tree (2026-09-16), VS Code's explorer filter:
 *   hidden until the header's button or `Ctrl`/`⌘`+`Shift`+`F` (while the
 *   sidebar has focus — `Ctrl`+`F` stays the browser's, `Ctrl`+`K` is
 *   kept for the command palette) shows it. `useTreeFilter` prunes the
 *   tree to matches and their ancestors and keeps the person's folds
 *   out of it, so clearing the query gives the tree back exactly as it
 *   was folded; the rows draw the matched text in a `<mark>`, the count
 *   is announced, and Escape in the box clears, hides and hands focus
 *   back to the tree's row.
 */
import type { ContextMenuItem } from '@nuxt/ui';
import NavigationTreeActions from '~/components/NavigationTreeActions.vue';
import type { TreeNode } from '~/composables/useTree';
import { useTreeFilter } from '~/composables/useTreeFilter';
import { treeRowActions, type TreeRowAction } from '~/composables/useTreeRowActions';

const props = defineProps<{
  workspaceId: string | null;
  /** The page open on screen, if any: marked current and revealed. */
  currentNodeId?: string | null;
}>();

const tree = useWorkspaceTree(() => props.workspaceId);
const { status, nodes, rootId, message, collapsedIds, selectedId, load, reorder, applyCreated, applyRenamed, reveal } = tree;

/**
 * The filter owns which rows are shown and which folds apply: the
 * person's own, or a per-query set while a query is active. Everything
 * below that draws or walks the tree reads these two, never `nodes` and
 * `collapsedIds` directly.
 */
const filter = useTreeFilter(nodes, collapsedIds, tree.toggleCollapsed);
const shownNodes = filter.shownNodes;
const shownCollapsedIds = filter.effectiveCollapsedIds;
const toggleCollapsed = filter.toggleCollapsed;

// The tree is the frame's own request, made on every screen inside a
// workspace, so a 401 here is the frame's own signed-out state and takes
// the one rule every screen takes: leave for sign-in and come back.
useSignInRedirect().redirectWhenSignedOut(status);

/** The row holding the tree's single tab stop; the selection is `useWorkspaceTree`'s and outlives this component. */
const activeId = ref<string | null>(null);

// Load on mount and whenever the workspace changes — a tree already
// loaded for this workspace is shown at once and refreshed behind it.
// Client only: since the read layer answers screens on the server, the
// frame knows its workspace during the server's render pass on every
// visit after the first, and this immediate watch ran there too — a
// `$fetch` with no session cookie, answered 401, written into the shared
// tree state and serialised with the page, so the client hydrated a
// signed-out tree and `redirectWhenSignedOut` above bounced a signed-in
// reader to sign-in on every reload (2026-09-16). The tree is fetched by
// the browser, as it always was.
watch(
  () => props.workspaceId,
  (id) => {
    if (id && import.meta.client) void load();
  },
  { immediate: true },
);

// The open page is the selection: it holds the fill, the toolbar acts on
// it, and its ancestors unfold so the row is visible.
watch(
  [() => props.currentNodeId, status],
  ([nodeId, treeStatus]) => {
    if (!nodeId || treeStatus !== 'success') return;
    selectedId.value = nodeId;
    activeId.value = nodeId;
    reveal(nodeId);
  },
  { immediate: true },
);

const reorderError = ref<string | null>(null);

/**
 * `newIndex` counts among the new parent's children *without* the moved
 * row, as `PATCH /nodes/:id/position` counts it. The move is drawn at
 * once and the request follows (`useTree`); a refusal snaps the row back
 * and says why here, beside the tree, in the chip tier (docs/UI-CHECKLIST.md
 * §3 — recoverable, with the reason).
 */
async function onReorder(payload: { draggedId: string; newParentId: string; newIndex: number }): Promise<void> {
  reorderError.value = null;
  const ok = await reorder(payload.draggedId, payload.newParentId, payload.newIndex);
  if (!ok) {
    reorderError.value = "That move isn't allowed — you may only have read access to this item, or the target is in a different workspace.";
  }
}

/**
 * A pointer drop names a slot in the list as drawn, the dragged row still
 * in it; the server counts slots once that row has left. Dropping a row
 * below its own place among its siblings therefore has to step the slot
 * back by one, or it lands one row further than the pointer said — as it
 * did until 2026-09-16. The keyboard and the menu (`onReorder` directly)
 * already count from the row's own place.
 */
function onDrop(payload: { draggedId: string; newParentId: string; newIndex: number }): void {
  const dragged = entryOf(payload.draggedId);
  const newIndex = dragged && dragged.parentId === payload.newParentId && dragged.index < payload.newIndex ? payload.newIndex - 1 : payload.newIndex;
  void onReorder({ ...payload, newIndex });
}

/* ─── Keyboard: the ARIA tree pattern ─────────────────────────────────
 * `NavigationTreeNode` is a hand-rolled exception to checklist §4.1
 * because `UTree` cannot drag-reorder; the keyboard contract `UTree` would
 * have brought is therefore this component's to supply. The tree is one
 * tab stop (roving tabindex) and the arrow keys move within it.
 */
const treeEl = ref<HTMLElement | null>(null);

interface FlatNode {
  readonly node: TreeNode;
  readonly parentId: string;
  readonly index: number;
  readonly siblings: readonly TreeNode[];
}

/** Every row currently visible, in reading order — the order the arrow keys move in. */
const visible = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (list: readonly TreeNode[], parentId: string): void => {
    list.forEach((node, index) => {
      out.push({ node, parentId, index, siblings: list });
      if (node.children.length > 0 && !shownCollapsedIds.value.has(node.id)) walk(node.children, node.id);
    });
  };
  walk(shownNodes.value, rootId.value ?? '');
  return out;
});

/** The tab stop defaults to the first row, so `Tab` always lands somewhere real. */
watchEffect(() => {
  if (activeId.value && visible.value.some((v) => v.node.id === activeId.value)) return;
  activeId.value = visible.value[0]?.node.id ?? null;
});

function focusNode(nodeId: string | undefined): void {
  if (!nodeId) return;
  activeId.value = nodeId;
  void nextTick(() => {
    treeEl.value?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.focus();
  });
}

function onKeydown({ event, node, parentId, index }: { event: KeyboardEvent; node: TreeNode; parentId: string; index: number }): void {
  const flat = visible.value;
  const at = flat.findIndex((v) => v.node.id === node.id);
  if (at === -1) return;
  const entry = flat[at]!;

  // The keyboard's two ways into a context menu (docs/UI-CHECKLIST.md
  // §5: every pointer-only manipulation has a stated keyboard
  // equivalent). Handled here rather than left to the browser: Chromium
  // does fire `contextmenu` for both, but at coordinates it chooses,
  // and `preventDefault` keeps it from firing a second one.
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault();
    const row = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.dw-tree-row');
    if (row) openMenuFrom(row, node.id);
    return;
  }

  // Alt + arrows are the keyboard equivalent of the three drop zones a
  // pointer gets (docs/UI-CHECKLIST.md §5).
  if (event.altKey) {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      void onReorder({ draggedId: node.id, newParentId: parentId, newIndex: index - 1 });
    } else if (event.key === 'ArrowDown' && index < entry.siblings.length - 1) {
      event.preventDefault();
      void onReorder({ draggedId: node.id, newParentId: parentId, newIndex: index + 1 });
    } else if (event.key === 'ArrowRight' && index > 0) {
      event.preventDefault();
      const newParent = entry.siblings[index - 1]!;
      void onReorder({ draggedId: node.id, newParentId: newParent.id, newIndex: newParent.children.length });
    }
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusNode(flat[at + 1]?.node.id);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusNode(flat[at - 1]?.node.id);
      break;
    case 'ArrowRight':
      event.preventDefault();
      if (node.children.length > 0 && shownCollapsedIds.value.has(node.id)) toggleCollapsed(node.id);
      else focusNode(node.children[0]?.id);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      if (node.children.length > 0 && !shownCollapsedIds.value.has(node.id)) toggleCollapsed(node.id);
      else focusNode(flat.find((v) => v.node.id === parentId)?.node.id);
      break;
    case 'Home':
      event.preventDefault();
      focusNode(flat[0]?.node.id);
      break;
    case 'End':
      event.preventDefault();
      focusNode(flat[flat.length - 1]?.node.id);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      if (node.type === 'page') void navigateTo(`/pages/${node.id}`);
      else if (node.children.length > 0) toggleCollapsed(node.id);
      break;
    default:
      break;
  }
}

/** A row reports itself active when it takes focus — moving the tab stop and the selection, never navigating. */
function onActivate(nodeId: string): void {
  activeId.value = nodeId;
  selectedId.value = nodeId;
}

/** Deliberate activation: a click, or Enter/Space. */
function onOpen(nodeId: string): void {
  activeId.value = nodeId;
  selectedId.value = nodeId;
  void navigateTo(`/pages/${nodeId}`);
}

/** A click on a container row: pick it, and fold or unfold it. */
function onToggle(nodeId: string): void {
  activeId.value = nodeId;
  selectedId.value = nodeId;
  toggleCollapsed(nodeId);
}

const KEYBOARD_HELP =
  'Arrow keys move through the tree, Enter opens a page or folds a shelf, book or chapter, Alt with the arrow keys moves an item among its siblings, and Shift+F10 opens a row’s menu.';

/* ─── The row's context menu ──────────────────────────────────────────
 * One `UContextMenu` around the whole tree rather than one per row: a
 * 400-row tree is 400 rows and one menu. Reka opens it on `contextmenu`
 * after a tick; `onContextMenu` runs before that and pins which row the
 * event landed on, so the items are that row's when the menu renders.
 * The `⋯` button and the keyboard both go through the same event, so
 * there is exactly one way a menu opens.
 */
const actionsRef = ref<InstanceType<typeof NavigationTreeActions> | null>(null);
const menuEntry = ref<FlatNode | null>(null);
const menuOpen = ref(false);
/** What the menu asked for once it has closed and focus is back on the row — a dialog opened before that would return focus to a menu item that no longer exists. */
let afterMenuClose: (() => void) | null = null;
/** Copy link's confirmation — a live region always in the DOM (§5). */
const announcement = ref('');

function entryOf(nodeId: string): FlatNode | null {
  return visible.value.find((v) => v.node.id === nodeId) ?? null;
}

function onContextMenu(event: MouseEvent): void {
  const rowEl = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]');
  const entry = rowEl?.dataset.nodeId ? entryOf(rowEl.dataset.nodeId) : null;
  if (!entry) {
    // The tree's padding, not a row: nothing to offer, and no native
    // menu for the browser's own idea of the page either.
    event.preventDefault();
    return;
  }
  menuEntry.value = entry;
  // Right-clicking a row picks it, as every explorer does; the toolbar
  // then names it too.
  activeId.value = entry.node.id;
  selectedId.value = entry.node.id;
}

/** The `⋯` button and the keyboard open the menu by the one road right-click takes: a `contextmenu` event, anchored under the control. */
function openMenuFrom(anchor: HTMLElement, nodeId: string): void {
  const rect = anchor.getBoundingClientRect();
  const x = anchor.matches('button') ? rect.left : rect.left + Math.min(rect.width, 40);
  anchor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: rect.bottom }));
  activeId.value = nodeId;
}

function onMenuOpenChange(open: boolean): void {
  menuOpen.value = open;
}

/**
 * Escape, a selection or a click away: focus goes back to the row, then
 * whatever the menu asked for happens. Reka's `FocusScope` dispatches
 * this synchronously while its focus trap is still listening — a focus
 * moved here and now is pulled straight back into the menu — and only
 * releases the trap with the unmount, so the move is queued behind it,
 * the same way Reka queues its own default.
 */
function onMenuCloseAutoFocus(event: Event): void {
  event.preventDefault();
  const nodeId = menuEntry.value?.node.id;
  const run = afterMenuClose;
  afterMenuClose = null;
  window.setTimeout(() => {
    if (nodeId) {
      activeId.value = nodeId;
      treeEl.value?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.focus();
    }
    run?.();
  }, 0);
}

async function copyLink(node: TreeNode): Promise<void> {
  const href = `${window.location.origin}/pages/${node.id}`;
  try {
    await navigator.clipboard.writeText(href);
    announcement.value = `Link to “${node.title}” copied.`;
  } catch {
    announcement.value = `Couldn’t copy the link. It is ${href}.`;
  }
}

function runAction(entry: FlatNode, action: TreeRowAction): void {
  const { node, parentId, index, siblings } = entry;
  switch (action.kind) {
    case 'create':
      afterMenuClose = () => actionsRef.value?.openCreate(action.childType);
      break;
    case 'rename':
      afterMenuClose = () => actionsRef.value?.openRename();
      break;
    case 'move-up':
      if (index > 0) void onReorder({ draggedId: node.id, newParentId: parentId, newIndex: index - 1 });
      break;
    case 'move-down':
      if (index < siblings.length - 1) void onReorder({ draggedId: node.id, newParentId: parentId, newIndex: index + 1 });
      break;
    case 'copy-link':
      void copyLink(node);
      break;
    default:
      break;
  }
}

/* ─── The filter ──────────────────────────────────────────────────────── */
const FILTER_BOX_ID = 'navigation-tree-filter';
const filterInput = ref<{ inputRef?: HTMLInputElement | null } | null>(null);
const rootEl = ref<HTMLElement | null>(null);
/** The sidebar the tree stands in, by the id `WorkspaceSidebar` gives it — or this component when it stands alone. */
const SIDEBAR_ELEMENT_ID = 'dw-frame-sidebar-workspace';

function focusFilterBox(): void {
  void nextTick(() => filterInput.value?.inputRef?.focus());
}

function showFilter(): void {
  filter.show();
  focusFilterBox();
}

/** Hide, and hand focus to the tree — the row that holds the tab stop. */
function hideFilter(): void {
  filter.hide();
  focusNode(activeId.value ?? undefined);
}

function toggleFilter(): void {
  if (filter.open.value) hideFilter();
  else showFilter();
}

function onFilterEscape(): void {
  hideFilter();
}

/**
 * `Ctrl`/`⌘`+`Shift`+`F` while the sidebar has focus. The chord is
 * registered only while focus is inside the sidebar, so anywhere else it
 * is not swallowed and not answered: `Ctrl`+`F` is the browser's find
 * everywhere, and `Ctrl`+`K` is reserved for the command palette.
 */
const focusInSidebar = ref(false);
function readFocus(): void {
  const scope = document.getElementById(SIDEBAR_ELEMENT_ID) ?? rootEl.value;
  focusInSidebar.value = Boolean(scope && document.activeElement && scope.contains(document.activeElement));
}
onMounted(() => {
  document.addEventListener('focusin', readFocus);
  document.addEventListener('focusout', readFocus);
  readFocus();
});
onBeforeUnmount(() => {
  document.removeEventListener('focusin', readFocus);
  document.removeEventListener('focusout', readFocus);
});
defineShortcuts(computed(() => (focusInSidebar.value ? { meta_shift_f: { usingInput: true, handler: toggleFilter } } : {})));

const menuItems = computed<ContextMenuItem[][]>(() => {
  const entry = menuEntry.value;
  if (!entry) return [];
  return treeRowActions(entry.node, { index: entry.index, siblingCount: entry.siblings.length }).map((group) =>
    group.map((action) => ({
      label: action.label,
      icon: action.icon,
      disabled: action.disabled,
      description: action.reason,
      to: action.to,
      onSelect: action.disabled || action.to ? undefined : () => runAction(entry, action),
    })),
  );
});
</script>

<template>
  <div ref="rootEl" class="flex min-h-0 flex-1 flex-col gap-2">
    <!-- The write affordances, above the tree and outside it: a control
         inside a row would sit on top of the row's drag-and-drop and its
         `Alt`-arrow reorder. -->
    <NavigationTreeActions
      v-if="status === 'success'"
      ref="actionsRef"
      :nodes="nodes"
      :root-id="rootId"
      :selected-id="selectedId"
      @created="applyCreated"
      @renamed="applyRenamed"
    />

    <div class="flex items-center justify-between gap-2 px-2">
      <!-- The section headline of a navigation drawer: `title-small` on
           `on-surface-variant` (docs/DESIGN-SYSTEM.md §9.2). -->
      <span id="navigation-tree-heading" class="text-title-small text-muted">Contents</span>
      <span class="flex items-center gap-1">
        <!-- The filter's toggle: icon-only, so a name and a tooltip
             (§4.3); `aria-expanded` and `aria-controls` say what it does
             to what. Offered only once there is a tree to filter. -->
        <UTooltip v-if="status === 'success' && nodes.length > 0" text="Filter tree" :kbds="['meta', 'shift', 'F']">
          <UButton
            icon="i-lucide-filter"
            variant="ghost"
            color="neutral"
            size="xs"
            square
            aria-label="Filter tree"
            :aria-expanded="filter.open.value"
            :aria-controls="FILTER_BOX_ID"
            :class="filter.open.value ? 'text-secondary' : undefined"
            @click="toggleFilter"
          />
        </UTooltip>
        <!-- The keyboard contract is one tooltip away rather than a paragraph
             on every screen; the same sentence is the tree's description for
             assistive technology, always in the DOM. -->
        <UTooltip :text="KEYBOARD_HELP" :ui="{ content: 'max-w-64 h-auto py-2 text-wrap' }">
          <UButton
            icon="i-lucide-circle-help"
            variant="ghost"
            color="neutral"
            size="xs"
            square
            aria-label="Keyboard help"
            aria-describedby="navigation-tree-keyboard-help"
          />
        </UTooltip>
      </span>
      <p id="navigation-tree-keyboard-help" class="sr-only">{{ KEYBOARD_HELP }}</p>
    </div>

    <!-- The filter box, only while asked for. A text field in chrome:
         `h-10`, the tree row's own height (docs/DESIGN-SYSTEM.md §7.2),
         not the 56px content-area field — recorded in that file's §14;
         the text stays 16px (§9.5). Escape clears, hides and hands focus
         back to the tree. -->
    <div v-if="filter.open.value" :id="FILTER_BOX_ID" class="px-2">
      <UInput
        ref="filterInput"
        v-model="filter.query.value"
        type="search"
        icon="i-lucide-filter"
        placeholder="Filter by title"
        aria-label="Filter tree by title"
        autocomplete="off"
        class="w-full"
        :ui="{ base: 'h-10' }"
        @keydown.escape.prevent="onFilterEscape"
      />
    </div>
    <!-- The count, announced: always in the DOM, only its text changes (§5). -->
    <p data-testid="tree-filter-status" role="status" aria-live="polite" class="sr-only">{{ filter.announcement.value }}</p>

    <!-- Loading: rows the shape of the rows that will replace them. -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="tree-skeleton" class="space-y-1 px-2" aria-hidden="true">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-10 w-5/6 ms-3" />
      <USkeleton class="h-10 w-4/6 ms-6" />
      <USkeleton class="h-10 w-5/6 ms-3" />
    </div>

    <!-- Denied and missing are states the person navigated into, not
         failures: plain sentences in the pane, in the same words the
         dashboard uses, never an alert. -->
    <p v-else-if="status === 'forbidden'" data-testid="tree-forbidden" class="px-2 text-body-medium text-muted">
      You don't have access to this workspace. Ask a workspace admin to grant you access.
    </p>

    <p v-else-if="status === 'not-found'" data-testid="tree-not-found" class="px-2 text-body-medium text-muted">
      This workspace does not exist. It may have been renamed, or the link may be wrong.
    </p>

    <InlineNotice v-else-if="status === 'network-error'" tier="bar" tone="error" role="alert" icon="i-lucide-circle-alert" title="Couldn't load the tree">
      {{ message }}
      <template #actions>
        <UButton size="sm" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
      </template>
    </InlineNotice>

    <template v-else>
      <!-- First-run empty state, in the product's vocabulary (checklist
           §3); the toolbar above it is the path forward. -->
      <p v-if="nodes.length === 0" data-testid="tree-empty" class="px-2 text-body-medium text-muted">
        No shelves yet. Use New… above to create the first shelf, then fill it with books, chapters and pages.
      </p>

      <!-- Filtered-empty is not first-run empty (§3): the tree has rows,
           none match, and the way out is to clear the filter. -->
      <div v-else-if="filter.active.value && shownNodes.length === 0" data-testid="tree-filter-empty" class="space-y-2 px-2">
        <p class="text-body-medium text-muted">No shelves, books, chapters or pages match “{{ filter.query.value.trim() }}”.</p>
        <UButton size="sm" variant="outline" color="neutral" icon="i-lucide-x" @click="filter.clear()">Clear filter</UButton>
      </div>

      <template v-else>
        <InlineNotice v-if="reorderError" tier="chip" tone="error" role="alert">{{ reorderError }}</InlineNotice>
        <!-- The list scrolls inside the pane: a 400-page book scrolls the
             tree, not the room. One context menu around it, for every
             row (see the script). Its container is the menu rung,
             `bg-accented` (docs/DESIGN-SYSTEM.md §9.6), the same as
             `UDropdownMenu`'s beside it; its width is capped at what the
             popper reports free — the library's own variable, the twin
             of the `max-h` its theme already carries — so at 320 a
             reason under an item wraps instead of running the menu off
             the screen (measured at x=474 on 2026-09-16) — wraps, not
             truncates, because a reason cut to "Already first …" is not
             a reason. -->
        <UContextMenu
          :items="menuItems"
          :ui="{ content: 'bg-accented max-w-(--reka-context-menu-content-available-width)', itemDescription: 'whitespace-normal' }"
          :content="{ onCloseAutoFocus: onMenuCloseAutoFocus, collisionPadding: 8 }"
          @update:open="onMenuOpenChange"
        >
          <ul
            ref="treeEl"
            role="tree"
            aria-labelledby="navigation-tree-heading"
            aria-describedby="navigation-tree-keyboard-help"
            class="min-h-0 flex-1 overflow-y-auto px-1"
            @contextmenu="onContextMenu"
          >
            <NavigationTreeNode
              v-for="(node, index) in shownNodes"
              :key="node.id"
              :node="node"
              :depth="0"
              :parent-id="rootId ?? ''"
              :index="index"
              :set-size="shownNodes.length"
              :active-id="activeId"
              :selected-id="selectedId"
              :collapsed-ids="shownCollapsedIds"
              :current-id="currentNodeId ?? null"
              :highlight="filter.active.value ? filter.query.value : undefined"
              @reorder="onDrop"
              @activate="onActivate"
              @open="onOpen"
              @toggle="onToggle"
              @keydown="onKeydown"
            >
              <template #row-actions="{ node: rowNode, active }">
                <!-- The row's menu, from a pointer: shown on hover and on
                     focus within the row, and while its menu is open; in
                     the tab order only on the row that holds the tree's
                     tab stop, so a 400-row tree stays one stop. Icon-only,
                     so both halves of §4.3: a name and a tooltip. -->
                <UTooltip text="Row actions">
                  <UButton
                    icon="i-lucide-ellipsis"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    square
                    :aria-label="`Actions for ${rowNode.title}`"
                    aria-haspopup="menu"
                    :aria-expanded="menuOpen && menuEntry?.node.id === rowNode.id"
                    :tabindex="active ? 0 : -1"
                    class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100"
                    @click="openMenuFrom($event.currentTarget as HTMLElement, rowNode.id)"
                  />
                </UTooltip>
              </template>
            </NavigationTreeNode>
          </ul>
        </UContextMenu>
        <p data-testid="tree-menu-status" role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>
      </template>
    </template>
  </div>
</template>

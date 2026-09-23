<script setup lang="ts">
/**
 * The navigation tree's header: **New…, Filter, Collapse all.** Three
 * controls, none destructive, none that renames.
 *
 * ── What the owner rejected, and why this is the shape ─────────────────
 *
 * On 2026-09-23 the owner rejected the tree this component used to draw.
 * It carried `New…`, `Rename…` and a red trash button in one row, and the
 * trash beside "New" read as *delete the workspace* — the misreading is
 * the defect, not the person. Both reference products agree, and agree
 * without exception:
 *
 * - **VS Code's Explorer title bar** registers exactly four actions
 *   against `MenuId.ViewTitle` — New File, New Folder, Refresh, Collapse
 *   Folders (`explorerView.ts`). Zero destructive actions are registered
 *   there. Delete and Rename are `MenuId.ExplorerContext` and keybindings
 *   only (`fileActions.contribution.ts`).
 * - **Obsidian's file explorer** toolbar is New note, New folder, Sort,
 *   Auto-reveal, Expand all, Collapse all; Delete and Rename live in the
 *   right-click menu and the command palette.
 *
 * So: creation and view controls here, everything that changes or destroys
 * a node in the row's own context menu and on the keyboard (`F2` renames,
 * `Delete` trashes — `NavigationTree`). This batch's research report, in
 * the session scratchpad, carries both sources.
 *
 * **There is no Refresh, deliberately.** VS Code needs one because its
 * tree mirrors a filesystem other processes write to. This tree is drawn
 * from the response of the request that changed it — a create, a rename, a
 * reorder and a delete each redraw the row they touched without asking for
 * the tree again (`useTree`, 2026-09-16) — so a Refresh button would be a
 * control with nothing to do, which docs/UI-CHECKLIST.md §6 counts as
 * observable breakage.
 *
 * ── Never a question with one answer ───────────────────────────────────
 *
 * `New…` asks the one `LEGAL_PARENT_TYPES` table what may go under the
 * picked row (`newRowChoice`, derived, never a second list). One legal
 * child — a shelf at the top level, a book in a shelf, a page in a chapter
 * — and it simply starts naming one, with no question asked. Several — a
 * book holds chapters *and* pages — and a short menu picks the kind first.
 * The dialog this replaces asked with a `Type` radio group that held a
 * single "Shelf" option, which is what the owner objected to.
 *
 * Nothing here opens a dialog any more: the name is typed in the row
 * (`NavigationTreeRowEditor`).
 */
import type { DropdownMenuItem } from '@nuxt/ui';
import { legalChildTypes, type NodeType } from '@deep-wiki/contracts';
import type { TreeNode } from '~/composables/useTree';
import { NODE_TYPE_ICONS, NODE_TYPE_LABELS, newRowChoice } from '~/composables/useTreeRowActions';

const props = defineProps<{
  nodes: readonly TreeNode[];
  rootId: string | null;
  /** The row the person picked — the "here" a new node goes under. `null` until they pick one, which means the top level. */
  selectedId: string | null;
  /** Whether the filter box is on screen, for `aria-expanded`. */
  filterOpen: boolean;
  /** The element the filter toggle controls, for `aria-controls`. */
  filterBoxId: string;
  /** There is a tree to filter: an empty tree offers no filter (checklist §3 — first-run empty is its own state). */
  canFilter: boolean;
  /** At least one container is open, so "Collapse all" has something to do. */
  canCollapseAll: boolean;
}>();

const emit = defineEmits<{
  /** Start naming a new node of `type` under `parentId`, in the row. */
  create: [target: { parentId: string; type: NodeType }];
  'toggle-filter': [];
  'collapse-all': [];
}>();

/* ─── Where a new node goes ───────────────────────────────────────────
 * The row the person picked, resolved up to the nearest node that can
 * legally hold children — so "New" means "here", which is how a tree is
 * read. With nothing picked there is no "here" and the answer is the top
 * level, which is also the only way a second shelf is ever reachable.
 */

interface Indexed {
  readonly node: TreeNode;
  readonly parentId: string;
}

const index = computed<Map<string, Indexed>>(() => {
  const map = new Map<string, Indexed>();
  const walk = (list: readonly TreeNode[], parentId: string): void => {
    for (const node of list) {
      map.set(node.id, { node, parentId });
      walk(node.children, node.id);
    }
  };
  walk(props.nodes, props.rootId ?? '');
  return map;
});

const rootLocationId = computed(() => props.rootId ?? '');

function typeOf(nodeId: string): NodeType {
  if (nodeId === rootLocationId.value) return 'workspace';
  return (index.value.get(nodeId)?.node.type ?? 'workspace') as NodeType;
}

const targetId = computed(() => {
  let current = props.selectedId;
  while (current) {
    const entry = index.value.get(current);
    if (!entry) break;
    if (legalChildTypes(entry.node.type as NodeType).length > 0) return current;
    current = entry.parentId === rootLocationId.value ? null : entry.parentId;
  }
  return rootLocationId.value;
});

const targetType = computed(() => typeOf(targetId.value));
const choice = computed(() => newRowChoice(targetType.value));

/** Where the new row will land, for the control's own tooltip: a person should know before pressing it. */
const targetLabel = computed(() => {
  const id = targetId.value;
  if (id === rootLocationId.value) return 'at the top level';
  return `in “${index.value.get(id)?.node.title ?? ''}”`;
});

const newTooltip = computed(() => {
  if (choice.value.kind === 'one') return `New ${NODE_TYPE_LABELS[choice.value.type].toLowerCase()} ${targetLabel.value}`;
  if (choice.value.kind === 'many') return `New item ${targetLabel.value}`;
  return 'There is nowhere to create anything here.';
});

/** The kinds a book admits — the menu shown only when the hierarchy leaves more than one answer. */
const typeItems = computed<DropdownMenuItem[]>(() =>
  choice.value.kind === 'many'
    ? choice.value.types.map((type) => ({
        label: NODE_TYPE_LABELS[type],
        icon: NODE_TYPE_ICONS[type],
        onSelect: () => emit('create', { parentId: targetId.value, type }),
      }))
    : [],
);

function onNew(): void {
  if (choice.value.kind !== 'one') return;
  emit('create', { parentId: targetId.value, type: choice.value.type });
}
</script>

<template>
  <!-- A named group, so the header's item set is one thing a review and a
       test can both point at. `role="group"` and not `role="toolbar"`: a
       toolbar owes arrow-key navigation between its controls, and these
       three are ordinary tab stops beside a tree that already owns the
       arrow keys. -->
  <div role="group" aria-label="Tree actions" class="mb-2 flex flex-wrap items-center gap-2 px-2">
    <!-- Tonal, not filled: this stands in the sidebar on every screen, and
         a filled button here would be a second primary beside whatever the
         screen's own is (checklist §2). 32px, the chrome height
         (DESIGN-SYSTEM §7.2). It keeps its label — it is the one thing a
         person comes to this header to do. -->
    <UDropdownMenu
      v-if="choice.kind === 'many'"
      :items="typeItems"
      :content="{ align: 'start', collisionPadding: 8 }"
      :ui="{ content: 'bg-accented max-w-(--reka-dropdown-menu-content-available-width)' }"
    >
      <UTooltip :text="newTooltip">
        <UButton size="sm" variant="soft" icon="i-lucide-plus" class="flex-1" aria-haspopup="menu" data-testid="tree-create-open">New…</UButton>
      </UTooltip>
    </UDropdownMenu>
    <UTooltip v-else :text="newTooltip">
      <UButton
        size="sm"
        variant="soft"
        icon="i-lucide-plus"
        class="flex-1"
        :aria-disabled="choice.kind === 'none' ? 'true' : undefined"
        data-testid="tree-create-open"
        @click="onNew"
      >
        New…
      </UButton>
    </UTooltip>

    <!-- Icon-only, so both halves of §4.3 — a name and a tooltip — and
         `aria-expanded`/`aria-controls` say what it does to what. -->
    <UTooltip v-if="canFilter" text="Filter tree" :kbds="['meta', 'shift', 'F']">
      <UButton
        icon="i-lucide-filter"
        variant="ghost"
        color="neutral"
        size="sm"
        square
        aria-label="Filter tree"
        :aria-expanded="filterOpen"
        :aria-controls="filterBoxId"
        :class="filterOpen ? 'text-secondary' : undefined"
        data-testid="tree-filter-toggle"
        @click="emit('toggle-filter')"
      />
    </UTooltip>

    <!-- `aria-disabled`, never the attribute: the attribute would take the
         control out of the tab order and put its own explanation behind a
         hover a keyboard user cannot perform (checklist §5). -->
    <UTooltip v-if="canFilter" :text="canCollapseAll ? 'Collapse all' : 'Everything is already collapsed.'">
      <UButton
        icon="i-lucide-chevrons-down-up"
        variant="ghost"
        color="neutral"
        size="sm"
        square
        aria-label="Collapse all"
        :aria-disabled="canCollapseAll ? undefined : 'true'"
        :aria-describedby="canCollapseAll ? undefined : 'tree-collapse-all-reason'"
        data-testid="tree-collapse-all"
        @click="canCollapseAll && emit('collapse-all')"
      />
    </UTooltip>
    <p v-if="canFilter && !canCollapseAll" id="tree-collapse-all-reason" class="sr-only">Everything is already collapsed.</p>
  </div>
</template>

<script setup lang="ts">
/**
 * One recursive level of the navigation tree (navigation-tree spec: "Drag
 * Reorder Writes Back To Position"). `UTree` (Nuxt UI) has no drag-reorder
 * support today, so this is a deliberate, minimal hand-rolled exception to
 * docs/UI-CHECKLIST.md §4.1's "use the library" rule — native HTML5
 * drag-and-drop, not a third-party DnD library, kept to exactly the
 * mechanism the library does not provide.
 *
 * **What that exception costs, and what has to be paid back.** The first
 * version of this component was a `div` with `draggable="true"`, no
 * `tabindex`, no link and no key handling. Measured on 2026-09-07, tabbing
 * through `/workspaces/:id/tree` reached the brand link, then the theme
 * toggle, then left the page: not one row was reachable, clicking a row did
 * nothing, and reordering was possible only by dragging a mouse. That is
 * docs/UI-CHECKLIST.md §5's first line ("every interactive element is
 * reachable and operable by keyboard alone") and §6's "no inert
 * interactions" — and it is precisely the keyboard contract §4.1 says a
 * library primitive brings and a hand-rolled one forfeits. Reaching for the
 * one mechanism `UTree` lacks does not license dropping the mechanisms it
 * has, so this component carries them itself:
 *
 * - **Roving tabindex.** The tree is one tab stop, per the ARIA tree
 *   pattern; `tree.vue` owns which item holds it.
 * - **Arrow keys** move between visible rows, `Home`/`End` jump to the
 *   ends, `ArrowLeft`/`ArrowRight` walk to parent and first child.
 * - **`Enter` / `Space`** opens a page — the thing the screen exists for —
 *   and folds a shelf, book or chapter. `ArrowLeft` on an open container
 *   folds it and `ArrowRight` on a folded one unfolds it, per the ARIA
 *   tree pattern. Until 2026-09-14 a container row hover-highlighted,
 *   showed a grab cursor and did nothing on click or Enter, and
 *   `aria-expanded` was always `true` with nothing to collapse — an inert
 *   interaction (docs/UI-CHECKLIST.md §6) and a lie to assistive
 *   technology at once; folding fixes both.
 * - **`Alt` + `ArrowUp` / `ArrowDown` / `ArrowRight`** are the keyboard
 *   equivalents of the three drop zones: move before the previous sibling,
 *   after the next one, or reparent under the previous sibling.
 *
 * Two ids, two meanings: `activeId` is the roving tab stop, which the
 * screen defaults to the first row so `Tab` lands somewhere; `selectedId`
 * is the row the user actually picked, which the toolbar acts on and
 * which is the one row drawn with the `secondary-container` fill —
 * docs/DESIGN-SYSTEM.md §5.2's one sanctioned use of a container fill on
 * an interactive element. A fill on the tab stop would have marked the
 * first row as chosen on every load.
 *
 * A drop in the top/bottom quarter of a row reorders among THAT ROW's OWN
 * siblings (before/after it) — hence `parentId`/`index` are required props,
 * not derived, since this component has no way to see its own position in
 * its parent's list otherwise. A drop in the middle band reparents under
 * that row, appended at the end of its children. Depth is `depth * 12px`
 * padding (DESIGN-SYSTEM §7.2's tree-indent value); each row is 40px tall
 * (that table's "default" density row height).
 */
import type { TreeNode } from '~/composables/useTree';

const props = defineProps<{
  node: TreeNode;
  depth: number;
  parentId: string;
  index: number;
  /** How many siblings this row sits among, for `aria-setsize`. */
  setSize: number;
  /** The id currently holding the tree's single tab stop. */
  activeId: string | null;
  /** The row the user picked — drawn with the selected fill and handed to the toolbar. */
  selectedId: string | null;
  /** Containers the user folded; everything else is open. */
  collapsedIds: ReadonlySet<string>;
  /** The page that is open on screen — marked `aria-current`, on the page row alone. */
  currentId?: string | null;
}>();

/**
 * What stands at the end of a row — a book's context menu, in the sidebar.
 * The row rents the space out and owes its tenant two things: a click there
 * neither opens nor folds the row, and a key pressed there never reaches the
 * tree's own handler (see `onKeydown`). The slot is threaded through every
 * recursive level so one `<template #row-actions>` covers the whole tree.
 */
defineSlots<{
  'row-actions'?: (scope: { node: TreeNode; active: boolean }) => unknown;
}>();

const emit = defineEmits<{
  reorder: [payload: { draggedId: string; newParentId: string; newIndex: number }];
  /** This row now holds the tree's tab stop. Focus only — never navigation. */
  activate: [nodeId: string];
  /** The user asked to open this row. Only a page has a destination this batch. */
  open: [nodeId: string];
  /** The user asked to fold or unfold this container. */
  toggle: [nodeId: string];
  keydown: [payload: { event: KeyboardEvent; node: TreeNode; parentId: string; index: number }];
}>();

const NODE_ICONS: Record<string, string> = {
  workspace: 'i-lucide-globe',
  shelf: 'i-lucide-library',
  book: 'i-lucide-book',
  chapter: 'i-lucide-folder',
  page: 'i-lucide-file-text',
};

const dropIndicator = ref<'before' | 'after' | 'on' | null>(null);

/** Only a page has a destination in this batch; a shelf, book or chapter is a container to fold and to reorder, not a place to go. */
const isNavigable = computed(() => props.node.type === 'page');
const isContainer = computed(() => props.node.children.length > 0);
const isExpanded = computed(() => isContainer.value && !props.collapsedIds.has(props.node.id));
const isSelected = computed(() => props.selectedId === props.node.id);
const isCurrent = computed(() => props.node.type === 'page' && props.currentId === props.node.id);

/** A click is the row's one activation: a page opens, a container folds. */
function onClick(): void {
  if (isNavigable.value) emit('open', props.node.id);
  else if (isContainer.value) emit('toggle', props.node.id);
}

function onDragStart(event: DragEvent): void {
  event.dataTransfer?.setData('text/plain', props.node.id);
  event.dataTransfer!.effectAllowed = 'move';
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  dropIndicator.value = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'on';
}

function onDragLeave(): void {
  dropIndicator.value = null;
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  const draggedId = event.dataTransfer?.getData('text/plain');
  const indicator = dropIndicator.value;
  dropIndicator.value = null;
  if (!draggedId || draggedId === props.node.id) return;

  if (indicator === 'on') {
    emit('reorder', { draggedId, newParentId: props.node.id, newIndex: props.node.children.length });
  } else {
    emit('reorder', { draggedId, newParentId: props.parentId, newIndex: indicator === 'before' ? props.index : props.index + 1 });
  }
}

function onChildReorder(payload: { draggedId: string; newParentId: string; newIndex: number }): void {
  emit('reorder', payload);
}

/**
 * Only the row the key press actually landed on reports it.
 *
 * `keydown` bubbles, and a nested row sits inside its ancestors' `<li>`s,
 * each carrying this same listener — so one press on a page three levels
 * deep reached `tree.vue` three times, each time carrying *that level's*
 * node, `parentId` and `index`. The last one to arrive won, and it was
 * always the outermost: `ArrowDown` on a shelf's first child moved the
 * focus to the second child and then an ancestor moved it to the shelf's
 * own next row — measured as landing back on the row it started from, so
 * a keyboard user could not walk past the first child of any shelf. Under
 * `Alt` the same duplicate is a reorder of an ancestor the user never
 * selected.
 *
 * `closest()` rather than `event.target === event.currentTarget`: the tab
 * stop is the `<li>`, so those are the same element today, but a control
 * inside the row (a rename field, a disclosure) must still report through
 * the row that contains it rather than fall silent.
 */
function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest('[role="treeitem"]') !== event.currentTarget) return;
  // A key pressed inside the row's action (a menu trigger) is that
  // control's to handle — Enter opens the menu, it must not also open the
  // page; an arrow must not also move the tree's focus.
  if (target?.closest('[data-row-actions]')) return;
  emit('keydown', { event, node: props.node, parentId: props.parentId, index: props.index });
}
</script>

<template>
  <li
    role="treeitem"
    :data-node-id="node.id"
    :aria-level="depth + 1"
    :aria-posinset="index + 1"
    :aria-setsize="setSize"
    :aria-expanded="isContainer ? isExpanded : undefined"
    :aria-selected="isSelected"
    :aria-current="isCurrent ? 'page' : undefined"
    :tabindex="activeId === node.id ? 0 : -1"
    class="dw-tree-item group"
    @keydown="onKeydown"
    @focus="emit('activate', node.id)"
  >
    <div
      draggable="true"
      class="dw-tree-row dw-state-layer flex h-10 min-h-10 items-center gap-2 rounded-md pe-1 text-body-medium text-default"
      :class="[
        // Every row does something on click now — open or fold — so every
        // row is a pointer target; the grab cursor promised a drag and
        // nothing else, on a row that also wanted to be clicked.
        'cursor-pointer',
        // The selected row and the drop target are the two places a row
        // takes a container fill: `secondary-container` is M3's
        // selected-state role (§1.2) and it is opaque, so it reads the same
        // on either theme. Hover and focus are the `dw-state-layer` above —
        // a `currentColor` overlay — never a step to another surface rung.
        // The `hover:bg-elevated` this row used to carry was measurably a
        // no-op: the row sits *on* `bg-elevated`, so hovering repainted the
        // same tone (oklch(0.94828) light, oklch(0.28448) dark) over itself
        // (§5.2).
        (isSelected || dropIndicator === 'on') && 'bg-secondary-container text-on-secondary-container',
        dropIndicator === 'before' && 'border-t-2 border-primary',
        dropIndicator === 'after' && 'border-b-2 border-primary',
      ]"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="onClick"
    >
      <!-- The fold state is drawn as well as announced: a chevron that
           turns, beside the type icon, on every container row. -->
      <UIcon
        v-if="isContainer"
        name="i-lucide-chevron-right"
        class="size-4 shrink-0 text-muted transition-transform duration-200 ease-standard"
        :class="isExpanded ? 'rotate-90' : undefined"
        aria-hidden="true"
      />
      <UIcon :name="NODE_ICONS[node.type] ?? 'i-lucide-file'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <!-- The icon carries the node's type, and an icon is never the only
           carrier of meaning (docs/UI-CHECKLIST.md §4.3) — so the
           accessible name says it in words. `title` keeps the full title
           available on hover once a long one truncates (§6). -->
      <span class="sr-only">{{ node.type }}:</span>
      <span class="truncate" :title="node.title">{{ node.title }}</span>
      <!-- `@click.stop`: the row's click is its activation (open or fold),
           and a click on the action is neither. -->
      <span v-if="$slots['row-actions']" data-row-actions class="ms-auto flex shrink-0 items-center" @click.stop>
        <slot name="row-actions" :node="node" :active="activeId === node.id" />
      </span>
    </div>
    <ul v-if="isExpanded" role="group">
      <NavigationTreeNode
        v-for="(child, childIndex) in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :parent-id="node.id"
        :index="childIndex"
        :set-size="node.children.length"
        :active-id="activeId"
        :selected-id="selectedId"
        :collapsed-ids="collapsedIds"
        :current-id="currentId"
        @reorder="onChildReorder"
        @activate="emit('activate', $event)"
        @open="emit('open', $event)"
        @toggle="emit('toggle', $event)"
        @keydown="emit('keydown', $event)"
      >
        <template v-if="$slots['row-actions']" #row-actions="scope">
          <slot name="row-actions" v-bind="scope" />
        </template>
      </NavigationTreeNode>
    </ul>
  </li>
</template>

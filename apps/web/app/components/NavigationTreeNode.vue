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
 * **A page row is a link** (2026-09-16). Its title is a `NuxtLink` — an
 * `<a href>` the browser can open in a new tab, copy or drag, and that the
 * router takes over on a plain click — kept out of the tab order
 * (`tabindex="-1"`) so the tree stays one tab stop on the `treeitem`. A
 * click on the link records the selection and leaves the navigation to
 * the link; a click elsewhere on the row, and Enter, open the page through
 * the tree as before; the focus a mouse puts on the link is handed to
 * the `treeitem` by the click, or by the end of a drag, so the tree's
 * tab stop is where focus is (`focusItem`). And the row warms the route
 * on intent — pointer enter or focus, once — with
 * `preloadRouteComponents`, because
 * `NuxtLink`'s own prefetch skips it in dev, the environment the owner
 * runs, and nothing had prefetched the read route's chunk before a click
 * (docs/TODO.md Findings, 2026-09-16, cause 3). A shelf, book or chapter
 * has no screen of its own, so its title stays a span.
 *
 * A drop in the top/bottom quarter of a row reorders among THAT ROW's OWN
 * siblings (before/after it) — hence `parentId`/`index` are required props,
 * not derived, since this component has no way to see its own position in
 * its parent's list otherwise. A drop in the middle band reparents under
 * that row, appended at the end of its children. Depth is `depth * 12px`
 * padding (DESIGN-SYSTEM §7.2's tree-indent value); each row is 40px tall
 * (that table's "default" density row height).
 */
import type { NodeType } from '@deep-wiki/contracts';
import type { TreeNode } from '~/composables/useTree';
import { highlightSegments } from '~/composables/useTreeFilter';
import { NODE_TYPE_ICONS } from '~/composables/useTreeRowActions';
import type { TreeRowEditorBinding } from '~/composables/useTreeRowEditor';
import { pageUrl } from '~/utils/routes';

const props = defineProps<{
  node: TreeNode;
  /** The workspace the tree belongs to, by the slug a page's address carries. */
  workspaceSlug: string;
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
  /** The tree filter's query, if one is active: the matched part of the title is marked. */
  highlight?: string;
  /**
   * The one row being named, if any (`useTreeRowEditor`). This row draws a
   * field in place of its title when the rename names it, and a draft row
   * at the end of its children when the creation names it as the parent.
   */
  editor?: TreeRowEditorBinding | null;
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

const dropIndicator = ref<'before' | 'after' | 'on' | null>(null);

/* ─── The row that is being named ─────────────────────────────────────
 * Two shapes, one field (`NavigationTreeRowEditor`): this row's title is
 * replaced by a box while it is being renamed, and a draft row stands at
 * the end of this row's children while something is being created under
 * it. Everything the row normally does — drag, click, the state layer, the
 * keyboard — is stood down for the duration, because the row is a text
 * field and a text field is not a drag handle.
 */
const isBeingRenamed = computed(
  () => props.editor?.snapshot.draft.mode === 'rename' && props.editor.snapshot.draft.nodeId === props.node.id,
);
const hasDraftChild = computed(
  () => props.editor?.snapshot.draft.mode === 'create' && props.editor.snapshot.draft.parentId === props.node.id,
);

/** Only a page has a destination in this batch; a shelf, book or chapter is a container to fold and to reorder, not a place to go. */
const isNavigable = computed(() => props.node.type === 'page');
const href = computed(() => pageUrl(props.workspaceSlug, props.node.id));
/** The title's element: the link, for a page; a plain span for a container. */
const NuxtLink = resolveComponent('NuxtLink');
const titleTag = computed(() => (isNavigable.value ? NuxtLink : 'span'));
const titleAttrs = computed(() => (isNavigable.value ? { to: href.value, tabindex: -1, prefetch: false } : {}));

/** The item element — where the tree's focus lives; the row and the link inside it never hold it. */
const itemEl = ref<HTMLElement | null>(null);

/**
 * A mouse click focuses the element under the pointer, and the link
 * carries a `tabindex`, so a click on a page's title leaves focus on the
 * `<a>` — inside the `treeitem`, but not on it. The tree's one tab stop
 * is the item (the ARIA tree pattern), and whatever asks "where was
 * focus?" afterwards — the confirm dialog that guards a dirty editor,
 * which returns focus to the control that asked — must find the row, not
 * a link the keyboard cannot reach (seen 2026-09-16, docs/TODO.md
 * Findings). So the click hands focus to the item — in the **capture**
 * phase, before the link's own handler runs (`onClickCapture`).
 *
 * Not on the link's `focus` event, where the first repair put it: a
 * focus move during the mousedown's own focus step makes Chromium cancel
 * the native drag of that link — `dragstart` never fires and the drop
 * never lands — and every mouse drag of a page row was gone (measured
 * 2026-09-16, docs/TODO.md Findings). A drag produces no click, so its
 * end hands focus over instead (`onDragEnd`).
 *
 * And not in the row's bubbling `click` either, where the second repair
 * first put it: a native click runs the microtask queue between its
 * listeners, so by the time the row's handler ran, the link's
 * `router.push` had already run the dirty-editor guard, the guard had
 * asked, the dialog had opened with the link recorded as the control
 * that asked, and its focus trap pulled the row's late `focus()` straight
 * back (measured 2026-09-16, same entry). A synthetic `click()` runs no
 * microtasks between listeners, which is why a unit test on the bubbling
 * handler passed while the browser failed. The `⋯` actions button is not
 * a link and keeps its own focus: its menu returns focus to it.
 */
function focusItem(): void {
  itemEl.value?.focus();
}

/** Before the link acts: a click on a page's title puts the tree's focus on the row first. */
function onClickCapture(event: MouseEvent): void {
  if (isNavigable.value && (event.target as HTMLElement | null)?.closest('a[href]')) focusItem();
}

/** The route's components, requested on the first sign of intent so the click finds them warm. Once per row. */
let warmed = false;
function warmRoute(): void {
  if (!isNavigable.value || warmed) return;
  warmed = true;
  void preloadRouteComponents(href.value).catch(() => {});
}
const isContainer = computed(() => props.node.children.length > 0);
const isExpanded = computed(() => isContainer.value && !props.collapsedIds.has(props.node.id));
/**
 * The children list is drawn while this row is open **or** while a draft
 * stands in it: a book with nothing in it yet still has to show the row
 * being typed into, and it has no `role="group"` of its own until it does.
 */
const showsChildren = computed(() => isExpanded.value || hasDraftChild.value);
/** The draft counts among its new siblings while it exists, so the ARIA tree stays true. */
const childSetSize = computed(() => props.node.children.length + (hasDraftChild.value ? 1 : 0));
const isSelected = computed(() => props.selectedId === props.node.id);
const isCurrent = computed(() => props.node.type === 'page' && props.currentId === props.node.id);
/** The title in pieces, the matched one marked — one piece and no mark when nothing is being filtered. */
const titleSegments = computed(() => highlightSegments(props.node.title, props.highlight ?? ''));

/** A click is the row's one activation: a page opens, a container folds. */
function onClick(event: MouseEvent): void {
  if (isNavigable.value) {
    // On the link itself the link navigates — the router on a plain
    // click, the browser on a modified one — and the row already took
    // the focus in the capture phase (which records the selection: the
    // item's own `focus` emits `activate`), so there is nothing left to
    // do; anywhere else on the row the tree opens the page.
    if (!(event.target as HTMLElement | null)?.closest('a[href]')) emit('open', props.node.id);
  } else if (isContainer.value) {
    emit('toggle', props.node.id);
  }
}

function onDragStart(event: DragEvent): void {
  event.dataTransfer?.setData('text/plain', props.node.id);
  event.dataTransfer!.effectAllowed = 'move';
}

/** The drag is over, dropped or not: the pointer's focus on the link is the row's now. */
function onDragEnd(): void {
  focusItem();
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
  // The same, for the field a name is typed into: every key the tree
  // answers — the arrows, Home, End, Enter, Delete, F2 — is a key someone
  // typing a name will press, so while the row is a text box the tree
  // hears none of them (docs/UI-CHECKLIST.md §5's keyboard model stays
  // coherent because the field, not the tree, is what has focus).
  if (target?.closest('[data-row-editor]')) return;
  emit('keydown', { event, node: props.node, parentId: props.parentId, index: props.index });
}
</script>

<template>
  <li
    ref="itemEl"
    role="treeitem"
    :data-node-id="node.id"
    :aria-level="depth + 1"
    :aria-posinset="index + 1"
    :aria-setsize="setSize"
    :aria-expanded="isContainer || hasDraftChild ? showsChildren : undefined"
    :aria-selected="isSelected"
    :aria-current="isCurrent ? 'page' : undefined"
    :tabindex="activeId === node.id ? 0 : -1"
    class="dw-tree-item"
    @keydown="onKeydown"
    @focus="
      emit('activate', node.id);
      warmRoute();
    "
  >
    <!-- Being renamed: the row *is* the field, so nothing else about a row
         applies to it — no drag, no click-to-open, no state layer, no
         selected fill. The name is edited where it lives (owner criterion,
         2026-09-23) and the field is the same one a creation types into. -->
    <NavigationTreeRowEditor
      v-if="isBeingRenamed && editor"
      :snapshot="editor.snapshot"
      :depth="depth"
      :has-chevron="isContainer"
      @update:value="editor.setValue"
      @commit="editor.commit"
      @cancel="editor.cancel"
    />

    <!-- `group` on the row, not the `<li>`: the item element holds the
         whole subtree, so a `group-hover` there lit every ancestor's `⋯`
         when a page three levels down was hovered (seen 2026-09-16). -->
    <div
      v-else
      draggable="true"
      class="dw-tree-row dw-state-layer group flex h-10 min-h-10 items-center gap-2 rounded-md pe-1 text-body-medium text-default"
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
      @dragend="onDragEnd"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click.capture="onClickCapture"
      @click="onClick"
      @pointerenter="warmRoute"
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
      <UIcon :name="NODE_TYPE_ICONS[node.type as NodeType] ?? 'i-lucide-file'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <!-- The icon carries the node's type, and an icon is never the only
           carrier of meaning (docs/UI-CHECKLIST.md §4.3) — so the
           accessible name says it in words. `title` keeps the full title
           available on hover once a long one truncates (§6). -->
      <span class="sr-only">{{ node.type }}:</span>
      <!-- A filter match is marked in the secondary family — the container
           pair on an ordinary row, the accent itself on the selected row,
           whose fill *is* `secondary-container` (docs/DESIGN-SYSTEM.md
           §1.2); both opaque, so the mark reads the same in either theme.
           `mark` alone would be the browser's yellow. -->
      <!-- A page's title is the link (see the script); the row's colour
           is the link's, so it reads as a row and not as prose underlined
           in the accent. -->
      <component :is="titleTag" v-bind="titleAttrs" class="truncate text-inherit no-underline" :title="node.title">
        <template v-for="(segment, segmentIndex) in titleSegments" :key="segmentIndex">
          <mark
            v-if="segment.match"
            :class="isSelected || dropIndicator === 'on' ? 'bg-secondary text-inverted' : 'bg-secondary-container text-on-secondary-container'"
          >{{ segment.text }}</mark>
          <template v-else>{{ segment.text }}</template>
        </template>
      </component>
      <!-- `@click.stop`: the row's click is its activation (open or fold),
           and a click on the action is neither. -->
      <span v-if="$slots['row-actions']" data-row-actions class="ms-auto flex shrink-0 items-center" @click.stop>
        <slot name="row-actions" :node="node" :active="activeId === node.id" />
      </span>
    </div>
    <ul v-if="showsChildren" role="group">
      <NavigationTreeNode
        v-for="(child, childIndex) in node.children"
        :key="child.id"
        :node="child"
        :workspace-slug="workspaceSlug"
        :depth="depth + 1"
        :parent-id="node.id"
        :index="childIndex"
        :set-size="childSetSize"
        :active-id="activeId"
        :selected-id="selectedId"
        :collapsed-ids="collapsedIds"
        :current-id="currentId"
        :highlight="highlight"
        :editor="editor"
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
      <!-- Where the new node will land: last among this row's children,
           which is where `POST /nodes` puts it (`insertCreatedNode`), so
           the draft stands exactly where the real row will. -->
      <NavigationTreeDraftRow
        v-if="hasDraftChild && editor"
        :editor="editor"
        :depth="depth + 1"
        :posinset="childSetSize"
        :set-size="childSetSize"
      />
    </ul>
  </li>
</template>

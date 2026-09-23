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
 * - Delete (2026-09-18, design.md Decision 8): "Delete…" last in every
 *   row's menu, the toolbar's trash control, and the `Delete` key on a
 *   focused row all run `deleteNode()` (`useTrash`) — the product's one
 *   confirm dialog, the row out of the tree before the server answers, a
 *   refusal putting it back with the reason in the chip beside the tree,
 *   and success said there too with a link to the Trash, and announced.
 *   Live only where the tree response says `manageable` or `isOwner`;
 *   elsewhere it stays in the menu, disabled, with the reason on show.
 */
import type { ContextMenuItem } from '@nuxt/ui';
import type { NodeType } from '@deep-wiki/contracts';
import type { TreeNode } from '~/composables/useTree';
import { deleteNode, type ForceDeleteFetcher, type TrashFetcher } from '~/composables/useTrash';
import { useTreeFilter } from '~/composables/useTreeFilter';
import { NODE_TYPE_LABELS, deleteRowAction, treeRowActions, type TreeRowAction } from '~/composables/useTreeRowActions';
import {
  useTreeRowEditor,
  type CreateNodeFetcher,
  type RenameNodeFetcher,
  type TreeRowEditorBinding,
} from '~/composables/useTreeRowEditor';
import { pageUrl, trashUrl } from '~/utils/routes';

const props = defineProps<{
  workspaceId: string | null;
  /** The same workspace's slug: what every row's address is built from (`utils/routes.ts`). */
  workspaceSlug: string | null;
  /** The page open on screen, if any: marked current and revealed. */
  currentNodeId?: string | null;
  /** Injected in tests, exactly as `useTree` takes its fetchers. */
  trashFetcher?: TrashFetcher;
  forceDeleteFetcher?: ForceDeleteFetcher;
  createFetcher?: CreateNodeFetcher;
  renameFetcher?: RenameNodeFetcher;
}>();

const tree = useWorkspaceTree(() => props.workspaceId);
const { status, nodes, rootId, message, manageable, isOwner, collapsedIds, selectedId, load, reorder, applyCreated, applyRenamed, removeNode, reveal, pathTo } = tree;

/**
 * The filter owns which rows are shown and which folds apply: the
 * person's own, or a per-query set while a query is active. Everything
 * below that draws or walks the tree reads these two, never `nodes` and
 * `collapsedIds` directly.
 */
const filter = useTreeFilter(nodes, collapsedIds, tree.toggleCollapsed, tree.collapseAll);
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
    // The two writes the header no longer carries (owner criterion,
    // 2026-09-23): both products put rename on `F2` and delete on the
    // `Delete` key, and both keep them out of the title bar.
    case 'F2':
      event.preventDefault();
      startRename(node.id);
      break;
    case 'Delete':
      event.preventDefault();
      void deleteRow(node.id);
      break;
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
      if (node.type === 'page') void navigateTo(pageUrl(props.workspaceSlug ?? '', node.id));
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
  void navigateTo(pageUrl(props.workspaceSlug ?? '', nodeId));
}

/** A click on a container row: pick it, and fold or unfold it. */
function onToggle(nodeId: string): void {
  activeId.value = nodeId;
  selectedId.value = nodeId;
  toggleCollapsed(nodeId);
}

const KEYBOARD_HELP =
  'Arrow keys move through the tree, Enter opens a page or folds a shelf, book or chapter, Alt with the arrow keys moves an item among its siblings, F2 renames an item where it stands, Delete moves an item to the trash, and Shift+F10 opens a row’s menu.';

/* ─── Naming a row, in the row ────────────────────────────────────────
 * The owner rejected the tree's create and rename dialogs on 2026-09-23.
 * Both are now a field drawn in the tree — a draft row under the parent a
 * creation names, the title replaced in place for a rename — and both run
 * through the one state machine (`useTreeRowEditor`), so the two surfaces
 * that can start them (the header's `New…`, and the row's own menu or
 * `F2`) cannot drift apart.
 *
 * The write stays optimistic in the sense the rest of this file already
 * is: the row is drawn from the response of the request that made it
 * (`applyCreated`, `applyRenamed`), never by asking for the tree again.
 */
const rowEditor = useTreeRowEditor({ createFetcher: props.createFetcher, renameFetcher: props.renameFetcher });

/** The reason a write was refused in a way the field could not fix — beside the tree, where a refused drag's reason already stands. */
const writeError = ref<string | null>(null);
/** The row focus goes back to when the field closes. */
let editorReturnId: string | null = null;

/** A creation at the top level: its draft row belongs to the tree's own list, not to any row. */
const rootDraft = computed(() => {
  const draft = rowEditor.state.value?.draft;
  return draft?.mode === 'create' && draft.parentId === (rootId.value ?? '');
});

const editorBinding = computed<TreeRowEditorBinding | null>(() =>
  rowEditor.state.value
    ? { snapshot: rowEditor.state.value, setValue: rowEditor.setValue, commit: onEditorCommit, cancel: onEditorCancel }
    : null,
);

/** Start naming a new node under `parentId`. The parent is unfolded first, or the draft row would be typed into behind a fold. */
function startCreate(target: { parentId: string; type: NodeType }): void {
  writeError.value = null;
  const trail = pathTo(target.parentId);
  const parent = trail[trail.length - 1] ?? null;
  if (parent && shownCollapsedIds.value.has(parent.id)) toggleCollapsed(parent.id);
  editorReturnId = activeId.value;
  rowEditor.startCreate({
    parentId: target.parentId,
    type: target.type,
    depth: trail.length,
    parentTitle: parent?.title ?? null,
  });
}

function startRename(nodeId: string): void {
  const node = nodeById(nodeId);
  if (!node) return;
  writeError.value = null;
  editorReturnId = nodeId;
  activeId.value = nodeId;
  selectedId.value = nodeId;
  rowEditor.startRename({ id: node.id, type: node.type, title: node.title });
}

async function onEditorCommit(): Promise<void> {
  const outcome = await rowEditor.commit();
  switch (outcome.kind) {
    case 'created': {
      applyCreated(outcome.node);
      const where = outcome.node.parentId === (rootId.value ?? '') ? 'the top level' : `“${pathTo(outcome.node.parentId).at(-1)?.title ?? ''}”`;
      // Said twice, in the two places §5 and §4.12 ask for: the region a
      // screen reader hears, and the toast a sighted person reads. It is
      // worth saying at all — rather than leaving the new row to speak for
      // itself — because creating a page navigates away from the screen the
      // person was on, and a shelf, book or chapter may be created under a
      // parent the scroll has left behind.
      const made = `Created ${NODE_TYPE_LABELS[outcome.node.type].toLowerCase()} “${outcome.node.title}” in ${where}.`;
      announcement.value = made;
      confirmed({ message: made });
      // Selected and opened: the thing just made is the thing being worked
      // on. A page has a screen to go to; a shelf, book or chapter has
      // none, so being picked and focused is all "opened" can mean for it.
      selectedId.value = outcome.node.id;
      await nextTick();
      focusNode(outcome.node.id);
      if (outcome.node.type === 'page') void navigateTo(pageUrl(props.workspaceSlug ?? '', outcome.node.id));
      break;
    }
    case 'renamed':
      applyRenamed(outcome.node);
      announcement.value = `Renamed to “${outcome.node.title}”.`;
      await nextTick();
      focusNode(outcome.node.id);
      break;
    case 'unchanged':
      await nextTick();
      focusNode(outcome.nodeId);
      break;
    case 'abandoned':
      writeError.value = outcome.message;
      await nextTick();
      focusNode(editorReturnId ?? undefined);
      break;
    default:
      // `kept` leaves the field open with the refusal in it; `ignored` was
      // a blank name or a second Enter. Neither closes anything.
      break;
  }
}

function onEditorCancel(): void {
  const outcome = rowEditor.cancel();
  if (outcome.kind !== 'cancelled') return;
  const back = outcome.draft.mode === 'rename' ? outcome.draft.nodeId : editorReturnId;
  void nextTick(() => focusNode(back ?? undefined));
}

/** Fold every container the tree is showing, and say so — the header's third control. */
function collapseAllRows(): void {
  if (!filter.canCollapseAll.value) return;
  const folded = filter.collapsibleIds.value.length;
  filter.collapseAll();
  announcement.value = `Collapsed ${folded} ${folded === 1 ? 'item' : 'items'}.`;
}

/* ─── Delete ──────────────────────────────────────────────────────────
 * One flow for the menu, the toolbar and the key (`useTrash.deleteNode`):
 * the dialog is `useConfirm`'s, the removal is the shared tree's, and
 * the two requests are the props' when a test injects them.
 */
const config = useRuntimeConfig();
const { confirm } = useConfirm();
const trashNode: TrashFetcher = (nodeId) =>
  props.trashFetcher ? props.trashFetcher(nodeId) : $fetch(`${config.public.apiBaseUrl}/nodes/${nodeId}`, { method: 'DELETE', credentials: 'include' });
const forceDeleteNode: ForceDeleteFetcher = (nodeId, body) =>
  props.forceDeleteFetcher
    ? props.forceDeleteFetcher(nodeId, body)
    : $fetch(`${config.public.apiBaseUrl}/nodes/${nodeId}/force-delete`, { method: 'POST', credentials: 'include', body });

/**
 * A refusal stays beside the tree until it is read; the success does not
 * (owner decision, 2026-09-23: "estas cosas pueden manejarse como
 * toasts"). So there is no `deleteNotice` ref any more — "Moved “X” to the
 * trash." is a toast carrying the way back, and the always-present live
 * region below still says it for a screen reader, which is the half of
 * that pair §5 relies on.
 */
const deleteError = ref<string | null>(null);
/** The product's toast tier — transient successes only (`useStatusToast`). */
const { confirmed } = useStatusToast();
/** The node, wherever it stands — the menu's row may be folded away by the time the dialog answers. */
function nodeById(nodeId: string): TreeNode | null {
  const walk = (list: readonly TreeNode[]): TreeNode | null => {
    for (const node of list) {
      if (node.id === nodeId) return node;
      const found = walk(node.children);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes.value);
}

async function deleteRow(nodeId: string): Promise<void> {
  const node = nodeById(nodeId);
  if (!node) return;
  const action = deleteRowAction(node, { manageable: manageable.value, isOwner: isOwner.value });
  if (action.disabled) {
    // The key on a row that cannot be deleted: say why, the way the menu
    // and the toolbar show it, rather than nothing.
    announcement.value = action.reason ?? '';
    return;
  }
  deleteError.value = null;
  const at = visible.value.findIndex((v) => v.node.id === nodeId);
  const result = await deleteNode(
    { id: node.id, type: node.type, title: node.title, visibleChildren: node.children.length },
    { confirm, trashFetcher: trashNode, forceDeleteFetcher: forceDeleteNode, removeRow: removeNode },
  );
  if (result.kind === 'cancelled') return;
  if (result.kind === 'refused') {
    deleteError.value = result.message;
    return;
  }
  // Said twice on purpose: the toast is what a sighted person reads, the
  // always-present region is what is reliably announced (§5). A trashed
  // node is recoverable for 30 days, so the way back travels with the
  // sentence — and the toast carrying an action stays on screen longer
  // than a plain one (`useStatusToast`). The question that got here was a
  // typed-name dialog, so §3's "a destructive action gets more than a
  // toast" is satisfied before this point, not by this notice.
  confirmed({
    message: `Moved “${node.title}” to the trash.`,
    icon: 'i-lucide-trash-2',
    action: { label: 'Restore from Trash', to: trashUrl(props.workspaceSlug ?? ''), icon: 'i-lucide-undo-2' },
  });
  announcement.value = `Moved “${node.title}” to the trash — restore it from the Trash.`;
  // The dialog returns focus to the row that asked, and that row is gone:
  // the tree's one tab stop lands on the row now standing where it stood.
  await nextTick();
  const rows = visible.value;
  focusNode(rows[Math.min(Math.max(at, 0), rows.length - 1)]?.node.id);
}

/* ─── The row's context menu ──────────────────────────────────────────
 * One `UContextMenu` around the whole tree rather than one per row: a
 * 400-row tree is 400 rows and one menu. Reka opens it on `contextmenu`
 * after a tick; `onContextMenu` runs before that and pins which row the
 * event landed on, so the items are that row's when the menu renders.
 * The `⋯` button and the keyboard both go through the same event, so
 * there is exactly one way a menu opens.
 */
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
  const href = `${window.location.origin}${pageUrl(props.workspaceSlug ?? '', node.id)}`;
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
      // The invocation named the kind ("New page…" on a book), so there is
      // nothing left to ask: the draft row opens under this row at once.
      if (action.childType) afterMenuClose = () => startCreate({ parentId: node.id, type: action.childType! });
      break;
    case 'rename':
      afterMenuClose = () => startRename(node.id);
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
    case 'delete':
      // After the menu has closed and focus is back on the row, so the
      // dialog's own focus return lands on the row too.
      afterMenuClose = () => void deleteRow(node.id);
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
  return treeRowActions(entry.node, {
    index: entry.index,
    siblingCount: entry.siblings.length,
    workspaceSlug: props.workspaceSlug ?? '',
    manageable: manageable.value,
    isOwner: isOwner.value,
  }).map((group) =>
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
    <!-- The section headline of a navigation drawer, and beside it the one
         piece of documentation the pane carries: `title-small` on
         `on-surface-variant` (docs/DESIGN-SYSTEM.md §9.2). The `?` is not
         an action on the tree — it states the keys, which
         docs/UI-CHECKLIST.md §5 requires to be named in the UI and not only
         in a comment — so it stands with the label rather than in the
         header's action group below. -->
    <div class="flex items-center justify-between gap-2 px-2">
      <span id="navigation-tree-heading" class="text-title-small text-muted">Contents</span>
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
      <p id="navigation-tree-keyboard-help" class="sr-only">{{ KEYBOARD_HELP }}</p>
    </div>

    <!-- The header: New…, Filter, Collapse all. Nothing destructive,
         nothing that renames — both live on the row's own menu and on the
         keyboard (owner criterion, 2026-09-23; `NavigationTreeActions` has
         the reasoning and the two precedents). -->
    <NavigationTreeActions
      v-if="status === 'success'"
      :nodes="nodes"
      :root-id="rootId"
      :selected-id="selectedId"
      :filter-open="filter.open.value"
      :filter-box-id="FILTER_BOX_ID"
      :can-filter="nodes.length > 0"
      :can-collapse-all="filter.canCollapseAll.value"
      @create="startCreate"
      @toggle-filter="toggleFilter"
      @collapse-all="collapseAllRows"
    />

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
    <!-- What the last write came to — a creation, a rename, a fold of
         everything, a copied link, a delete. Always in the DOM for the
         same reason the count is: a region inserted at the moment its text
         appears is frequently not announced at all (§5). It moved out of
         the rows' own branch when creation moved into the tree, because a
         first shelf is created on a tree that has no rows to hold it. -->
    <p data-testid="tree-menu-status" role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

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
           §3); the header above it is the path forward. It gives way the
           moment a name is being typed, because the tree is no longer
           empty — it holds the row being made. -->
      <p v-if="nodes.length === 0 && !rowEditor.isEditing.value" data-testid="tree-empty" class="px-2 text-body-medium text-muted">
        No shelves yet. Use New… above to create the first shelf, then fill it with books, chapters and pages.
      </p>

      <!-- Filtered-empty is not first-run empty (§3): the tree has rows,
           none match, and the way out is to clear the filter. -->
      <div
        v-else-if="filter.active.value && shownNodes.length === 0 && !rowEditor.isEditing.value"
        data-testid="tree-filter-empty"
        class="space-y-2 px-2"
      >
        <p class="text-body-medium text-muted">No shelves, books, chapters or pages match “{{ filter.query.value.trim() }}”.</p>
        <UButton size="sm" variant="outline" color="neutral" icon="i-lucide-x" @click="filter.clear()">Clear filter</UButton>
      </div>

      <template v-else>
        <InlineNotice v-if="reorderError" tier="chip" tone="error" role="alert">{{ reorderError }}</InlineNotice>
        <!-- A create or rename the field could not fix — no permission, a
             parent that has gone, a dead connection. The draft row is gone
             with it, so the reason stands where a refused drag's does
             (§3, recoverable, with a real reason). A name that is merely
             taken never reaches here: it stays beside the field. -->
        <InlineNotice v-if="writeError" tier="chip" tone="error" role="alert" data-testid="tree-write-error">{{ writeError }}</InlineNotice>
        <!-- A delete's refusal, in the chip tier beside the tree, where a
             refused drag's reason already stands (§3). Its success is not
             here: that one is over the moment it happens, so it is the
             toast tier (§4.12), and the question that preceded it was a
             typed-name dialog — §3's "a destructive action gets more than
             a toast" is answered before the delete, not after it. -->
        <InlineNotice v-if="deleteError" tier="chip" tone="error" role="alert" data-testid="tree-delete-error">{{ deleteError }}</InlineNotice>
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
              :workspace-slug="workspaceSlug ?? ''"
              :depth="0"
              :parent-id="rootId ?? ''"
              :index="index"
              :set-size="shownNodes.length"
              :active-id="activeId"
              :selected-id="selectedId"
              :collapsed-ids="shownCollapsedIds"
              :current-id="currentNodeId ?? null"
              :highlight="filter.active.value ? filter.query.value : undefined"
              :editor="editorBinding"
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
            <!-- A shelf being made: the top level's own draft row, at the
                 end, where `POST /nodes` will put the real one. -->
            <NavigationTreeDraftRow
              v-if="rootDraft && editorBinding"
              :editor="editorBinding"
              :depth="0"
              :posinset="shownNodes.length + 1"
              :set-size="shownNodes.length + 1"
            />
          </ul>
        </UContextMenu>
      </template>
    </template>
  </div>
</template>

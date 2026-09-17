<script setup lang="ts">
/**
 * The WYSIWYG editing surface (document-editor spec). Takes
 * `@deep-wiki/editor/mount` through `loadEditorMount()` — a dynamic
 * `import()`, never a static one — so this component itself can be
 * statically imported by the edit route while the actual ProseMirror-view
 * bundle only loads once edit mode is actually entered.
 * `scripts/checks/bundle-isolation.ts` enforces the "no static import of
 * `/mount`" half of this; the read route never imports this component at
 * all, which is the other half.
 *
 * The converters come from that same module. This file used to import
 * `fromMarkdown`/`toMarkdown` statically from `@deep-wiki/editor`, which
 * put the whole remark/micromark/mdast stack in the edit route's
 * pre-hydration chunk (measured 2026-09-16: 14 requests and 2.3 MB in
 * dev, most of a 199 KB chunk in prod) although nothing can parse
 * anything until the session has arrived and the mount chunk has loaded
 * anyway. And the import is no longer awaited *after* the session: the
 * route starts it before its session request, the read screen on pointer
 * intent towards "Edit", and this component awaits whichever already ran
 * (`~/utils/editor-mount`; docs/TODO.md Findings, "edit-mode latency").
 *
 * Arrow-key selection movement, Escape and Enter are all handled inside
 * the plugins themselves (`packages/editor/src/mount/{mention,slash}-
 * plugin.ts`) — this component only renders whatever state they report
 * and supplies the two things a ProseMirror plugin cannot reach itself:
 * fetching mention candidates over the network, and the access-mismatch
 * check.
 */
import type { MentionCandidate, MentionState, SlashState } from '@deep-wiki/editor';
import type { EditorView } from 'prosemirror-view';
import {
  blockTunesMenu,
  caretBlock,
  currentTurnIntoTarget,
  placeCaretIn,
  slashCommandIcon,
  TURN_INTO_TARGET_IDS,
  type BlockLike,
  type TunesActions,
  type TunesItem,
} from '~/utils/block-tunes';
import { loadEditorMount, type EditorMountModule } from '~/utils/editor-mount';
import { positionMenu, positionToolbar } from '~/utils/menu-position';

const props = defineProps<{
  markdown: string;
  workspaceId: string;
  pageId: string;
}>();

const emit = defineEmits<{
  /** The document as markdown, 300ms after the last transaction. */
  update: [markdown: string];
  /**
   * The history plugin's own depths after every transaction, undebounced
   * — what the contextual bar's Undo and Redo disable from
   * (`editor-commands.ts`, `EditorUpdate`). Read from the plugin's
   * counters, never inferred from keystrokes, so grouping is seen.
   */
  history: [depths: { undoDepth: number; redoDepth: number }];
}>();

const rootEl = ref<HTMLElement | null>(null);
/**
 * True once `mountEditor` has attached ProseMirror to `rootEl`.
 * Measured on 2026-09-16: this component's box was in the DOM 120–730 ms
 * before the view existed — an empty well where the page's skeleton had
 * just been. Until then the template keeps the skeleton's text lines up
 * and hides (never removes) the surface: the element has to exist for
 * ProseMirror to mount into it.
 */
const attached = ref(false);
/**
 * How many transactions the view has applied, selection-only ones
 * included, exposed on the editor root as `data-transactions`. Chrome
 * delivers `selectionchange` at the next rendering opportunity, so
 * ProseMirror learns where a click put the caret one frame later — a key
 * sent inside that frame is handled at the caret ProseMirror still holds.
 * No hand is that fast; Playwright is (docs/TODO.md Findings, 2026-09-16:
 * click, End, Enter split the paragraph at its START in 15 of 20 runs).
 * The count is the signal a harness waits on instead of a frame.
 */
const transactionCount = ref(0);
const mentionState = ref<MentionState | null>(null);
const slashState = ref<SlashState | null>(null);
const mentionCaretRect = ref<{ top: number; left: number } | null>(null);
const slashCaretRect = ref<{ top: number; left: number } | null>(null);
/** Set once a confirmed user mention is checked against `can()` and comes back unreadable (document-editor: "Mentioning A User Does Not Silently Grant Them Access"). */
const mentionMismatch = ref<string | null>(null);

/** The id of the option the arrow keys currently sit on, or `undefined` when no menu is open. Bound to the editor's `aria-activedescendant`, which is the only wire between the focused element and a menu rendered outside it. */
const activeOptionId = computed(() => {
  if (mentionState.value?.active && mentionState.value.candidates.length > 0) {
    return `dw-mention-option-${mentionState.value.selectedIndex}`;
  }
  if (slashState.value?.active && slashState.value.commands.length > 0) {
    return `dw-slash-option-${slashState.value.selectedIndex}`;
  }
  return undefined;
});

/** Which menu is open, for the editor's `aria-controls` / `aria-expanded`: the listbox a screen reader is told the textbox drives (checklist §5). */
const openMenuId = computed(() => {
  if (mentionState.value?.active) return MENTION_MENU_ID;
  if (slashState.value?.active) return SLASH_MENU_ID;
  return undefined;
});

const MENTION_MENU_ID = 'dw-mention-menu';
const SLASH_MENU_ID = 'dw-slash-menu';

/**
 * What `mountEditor` returns: the live view plus the command surface bound
 * to it — undo/redo, the marks, the block tunes, the drag hooks. Every
 * control this component renders acts through the handle, never through
 * `view.dispatch` with a transaction built here, so a button and the
 * keystroke it stands for can never disagree (`editor-commands.ts`).
 */
// The type is read off the loader's module type rather than imported from
// `@deep-wiki/editor/mount`: `scripts/checks/bundle-isolation.ts` sweeps
// every static specifier, `import type` included.
type EditorHandle = ReturnType<EditorMountModule['mountEditor']>;
type MountOptions = Parameters<EditorMountModule['mountEditor']>[0];
/** What the selection plugin reports: the snapshot plus both ends' viewport coordinates (`selection-plugin.ts`). */
type SelectionReport = Parameters<NonNullable<NonNullable<MountOptions['selection']>['onChange']>>[0];
let handle: EditorHandle | undefined;
let editorView: EditorView | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
/** The report the debounce is holding, so `flush()` can send it now. */
let pendingReport: (() => void) | null = null;

/**
 * Reports the pending document at once, if any. The screen calls it
 * before Save reads the buffer, closing the 300ms window in which a Save
 * took the document before the edit (docs/TODO.md, "a dirty editor has a
 * 300ms blind spot").
 */
function flush(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = undefined;
  const report = pendingReport;
  pendingReport = null;
  report?.();
}
/** The `"./mount"` module, kept from `loadEditorMount()` so the click paths below can build the same transactions the plugins build on Enter. */
let editorModule: Awaited<ReturnType<typeof loadEditorMount>> | undefined;

const { search: searchMentions, checkAccess } = useMentionCandidates(props.workspaceId, props.pageId);

/* ─── The selection toolbar ────────────────────────────────────────────
 * Shown over a non-empty text selection (never in a code block, never
 * over a node or gap selection — the plugin says which) while focus is
 * inside this component: the editor itself, or the toolbar the keyboard
 * reached. The link popover is the one moment focus legitimately leaves
 * both, so it keeps the toolbar up on its own. Typing collapses the
 * selection, so the toolbar goes the moment a key lands (docs/TODO.md,
 * "hidden while typing").
 */
const selection = ref<SelectionReport | null>(null);
const focusWithin = ref(false);
const linkPopoverOpen = ref(false);
const hostEl = ref<HTMLElement | null>(null);
const selectionToolbar = ref<{ focus: () => void } | null>(null);

const toolbarVisible = computed(
  () =>
    selection.value !== null &&
    selection.value.kind === 'text' &&
    !selection.value.empty &&
    selection.value.coords !== null &&
    (focusWithin.value || linkPopoverOpen.value),
);
const toolbarPosition = computed(() => (selection.value?.coords ? positionToolbar(selection.value.coords) : { top: 0, left: 0 }));

function onFocusIn(): void {
  focusWithin.value = true;
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  focusWithin.value = next instanceof Node && hostEl.value !== null && hostEl.value.contains(next);
}

/**
 * The keyboard's ways to the two surfaces a pointer reaches by hovering
 * (checklist §5): `Ctrl`/`⌘`+`Shift`+`.` moves focus from the editor into
 * the selection toolbar — read by `code`, because `Shift`+`.` reports `>`
 * on a US layout and something else on others — and `Ctrl`/`⌘`+`/` opens
 * the tunes menu for the caret's block. Any other key hides the block
 * handle: it is the pointer's, and typing is not the moment for it.
 */
function onHostKeydown(event: KeyboardEvent): void {
  const modifier = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (modifier && event.shiftKey && (event.code === 'Period' || event.key === '.' || event.key === '>')) {
    if (!toolbarVisible.value) return;
    event.preventDefault();
    selectionToolbar.value?.focus();
    return;
  }
  if (modifier && !event.shiftKey && (event.code === 'Slash' || event.key === '/')) {
    event.preventDefault();
    void openTunesForCaret();
    return;
  }
  if (!tunesOpen.value) hoveredBlock.value = null;
}

/* ─── The block handle ─────────────────────────────────────────────────
 * One `EditorBlockHandle`, moved to whichever top-level block the pointer
 * is over (`blockAt`, one lookup per frame), gone when the pointer leaves
 * or a key lands, kept while its menu is open or a drag is under way. The
 * drag is bridged to ProseMirror through `startBlockDrag`/`endBlockDrag`
 * (`block-drag.ts`: from there its own `drop` handler moves the node and
 * the drop cursor draws the target). The tunes act on the block the
 * *selection* is in, so opening the menu first places the caret in the
 * hovered block (`placeCaretIn`), then dry-runs every command on it so
 * the menu can say what it withholds and why (`utils/block-tunes.ts`).
 */
interface HoveredBlock {
  readonly pos: number;
  readonly node: BlockLike;
  /** Offset from this component's top edge, so the handle sits on the block's first line. */
  readonly top: number;
}

const HANDLE_SIZE = 24;
const hoveredBlock = ref<HoveredBlock | null>(null);
const tunesOpen = ref(false);
const tunesItems = ref<TunesItem[][]>([]);
let handleFrame: number | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let dragging = false;

/** The platform's modifier as text for `aria-keyshortcuts`, read on mount because the platform is the client's (the same reading `SidebarToggle` makes). */
const modifierName = ref('Control');
onMounted(() => {
  modifierName.value = /Macintosh;/.test(navigator.userAgent) ? 'Meta' : 'Control';
});

function placeHandleAt(hit: { pos: number; node: BlockLike; rect: { top: number } | null }): void {
  const host = hostEl.value;
  if (!host || !hit.rect) return;
  const dom = editorView?.nodeDOM(hit.pos);
  const lineHeight = dom instanceof HTMLElement ? Number.parseFloat(getComputedStyle(dom).lineHeight) : Number.NaN;
  const centred = Number.isFinite(lineHeight) ? Math.max(0, (lineHeight - HANDLE_SIZE) / 2) : 0;
  hoveredBlock.value = { pos: hit.pos, node: hit.node, top: hit.rect.top - host.getBoundingClientRect().top + centred };
}

function onPointerMove(event: PointerEvent): void {
  if (tunesOpen.value || dragging || !handle) return;
  if (!(event.target instanceof Node) || !rootEl.value?.contains(event.target)) return;
  if (handleFrame !== null) return;
  const coords = { left: event.clientX, top: event.clientY };
  handleFrame = requestAnimationFrame(() => {
    handleFrame = null;
    const hit = handle?.blockAt(coords);
    if (hit?.rect) placeHandleAt(hit);
  });
}

/** The pointer left the editor: the handle goes after a beat, unless it went to the handle itself (8px away, across nothing). */
function scheduleHandleHide(): void {
  cancelHandleHide();
  hideTimer = setTimeout(() => {
    if (!tunesOpen.value && !dragging) hoveredBlock.value = null;
  }, 200);
}

function cancelHandleHide(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = undefined;
}

const tunesActions: TunesActions = {
  moveUp: () => void handle?.moveBlockUp(),
  moveDown: () => void handle?.moveBlockDown(),
  duplicate: () => void handle?.duplicateBlock(),
  remove: () => void handle?.deleteBlock(),
  // `turnInto` runs the `/` command at the caret, exactly as typing `/`
  // there would: inside a list item that yields `- # Title`, a heading
  // inside the item. Text lifts the item out first, then the target
  // applies to the paragraph it became — except task list, which marks
  // the item in place (docs/TODO.md Findings 2026-09-16, "limits").
  turnInto: (id) => {
    if (hoveredBlock.value?.node.type.name === 'list' && id !== 'task-list') handle?.turnInto('text');
    handle?.turnInto(id);
  },
};

/** Builds the menu for the hovered block: the caret goes into it, then every command is dry-run there. */
function prepareTunes(): void {
  const block = hoveredBlock.value;
  const mod = editorModule;
  if (!block || !mod || !editorView) return;
  placeCaretIn(editorView, block.pos);
  const state = editorView.state;
  const inList = block.node.type.name === 'list';
  const turnInto = mod.SLASH_COMMANDS.filter((command) => TURN_INTO_TARGET_IDS.includes(command.id)).map((command) => ({
    id: command.id,
    label: command.label,
    applicable: inList && command.id !== 'task-list' ? mod.turnInto('text')(state) : mod.turnInto(command.id)(state),
  }));
  tunesItems.value = blockTunesMenu(
    {
      blockType: block.node.type.name,
      canMoveUp: mod.moveBlockUp(state),
      canMoveDown: mod.moveBlockDown(state),
      canDuplicate: mod.duplicateBlock(state),
      canDelete: mod.deleteBlock(state),
      turnInto,
      currentTargetId: currentTurnIntoTarget(block.node),
    },
    tunesActions,
  );
}

watch(tunesOpen, (open) => {
  if (open) prepareTunes();
});

/** The menu closed: focus back to the editor, and the handle — stale after a move or a delete — goes. */
function onTunesClosed(): void {
  focusEditor();
  hoveredBlock.value = null;
}

/** `Ctrl`/`⌘`+`/`: the handle at the caret's block, and its menu open. */
async function openTunesForCaret(): Promise<void> {
  if (!editorView || !handle) return;
  const block = caretBlock(editorView.state);
  if (!block) return;
  const dom = editorView.nodeDOM(block.pos);
  placeHandleAt({ pos: block.pos, node: block.node as BlockLike, rect: dom instanceof HTMLElement ? dom.getBoundingClientRect() : null });
  await nextTick();
  tunesOpen.value = true;
}

function onHandleDragStart(event: DragEvent): void {
  const block = hoveredBlock.value;
  if (!block || !handle) return;
  dragging = true;
  const dom = editorView?.nodeDOM(block.pos);
  // The block itself as the drag image, not the 24px handle: what moves
  // is what the person sees moving.
  if (event.dataTransfer && dom instanceof HTMLElement && typeof event.dataTransfer.setDragImage === 'function') event.dataTransfer.setDragImage(dom, 0, 0);
  handle.startBlockDrag(block.pos, event.dataTransfer ?? undefined);
}

function onHandleDragEnd(): void {
  dragging = false;
  handle?.endBlockDrag();
  hoveredBlock.value = null;
}

function focusEditor(): void {
  editorView?.focus();
}

/**
 * Enter and Tab while a menu is open confirm the highlighted row — here,
 * on the capture phase of this wrapper, before ProseMirror's own listener
 * on the editor sees the key. Since `keymap.ts` bound `Enter`
 * (2026-09-14) the keymap plugin, first in `buildEditorPlugins`' list,
 * claims it before the mention and slash plugins can, so Enter in an
 * open menu split the block and left `/query` in place (docs/TODO.md
 * Findings, 2026-09-16). The package is another batch's; the host runs
 * the same one-transaction confirm the click paths run, so undo removes
 * the whole insertion as one step either way.
 */
function onHostKeydownCapture(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== 'Tab') return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!(event.target instanceof Node) || !rootEl.value?.contains(event.target)) return;
  if (mentionState.value?.active) {
    event.preventDefault();
    event.stopPropagation();
    confirmMentionAt(mentionState.value.selectedIndex);
    return;
  }
  if (slashState.value?.active) {
    event.preventDefault();
    event.stopPropagation();
    confirmSlashAt(slashState.value.selectedIndex);
  }
}

function onToolbarToggle(name: Parameters<EditorHandle['toggleMark']>[0]): void {
  handle?.toggleMark(name);
}

function onToolbarSetLink(href: string): void {
  handle?.setLink(href);
}

function onToolbarUnsetLink(): void {
  handle?.unsetLink();
}

/** document-editor: "Mentioning A User Does Not Silently Grant Them Access" — the check a confirmed user mention runs, whichever way it was confirmed. */
function onMentionConfirmed(candidate: MentionCandidate): void {
  if (candidate.type !== 'user') return;
  void checkAccess(candidate.id).then((canRead) => {
    mentionMismatch.value = canRead ? null : `${candidate.label} does not have access to this page yet — mentioning them does not grant it.`;
  });
}

/**
 * The pointer half of "confirmed (Enter or click)" (`mention-plugin.ts`).
 * The plugins own Enter inside `handleKeyDown` and expose no confirm
 * action, so a click builds the very transaction Enter builds — the
 * insertion and the dismiss in ONE transaction, so undo removes the whole
 * mention as one step (document-editor: "Mention And Slash Insertions
 * Undo As One Step") — and then hands focus back to the editor, which the
 * `mousedown.prevent` on the row kept from leaving in the first place.
 * Measured on 2026-09-14, before this existed: clicking the second
 * candidate left the text unchanged, the menu open and the editor
 * unfocused (docs/UI-CHECKLIST.md §6, "no inert interactions").
 */
function confirmMentionAt(index: number): void {
  const state = mentionState.value;
  if (!state?.active || !editorView || !editorModule) return;
  const candidate = state.candidates[index];
  if (!candidate) return;
  const tr = editorModule
    .insertMention(candidate, { from: state.from, to: state.to }, editorView.state.tr)
    .setMeta(editorModule.mentionPluginKey, { type: 'dismiss' });
  editorView.dispatch(tr);
  onMentionConfirmed(candidate);
  editorView.focus();
}

/** The click twin of the slash plugin's Enter: look the runnable command up by id (the state only carries the render-facing summary) and let `confirmSlashCommand` build the one transaction, or dismiss if it refuses. */
function confirmSlashAt(index: number): void {
  const state = slashState.value;
  if (!state?.active || !editorView || !editorModule) return;
  const summary = state.commands[index];
  if (!summary) return;
  const command = editorModule.SLASH_COMMANDS.find((candidate) => candidate.id === summary.id);
  if (!command) return;
  const tr = editorModule.confirmSlashCommand(editorView.state, command, { from: state.from, to: state.to });
  editorView.dispatch(tr ?? editorView.state.tr.setMeta(editorModule.slashPluginKey, { type: 'dismiss' }));
  editorView.focus();
}

async function mount(): Promise<void> {
  const mod = await loadEditorMount();
  editorModule = mod;
  if (!rootEl.value) return;

  let lastMentionQuery: string | null = null;
  const initialDoc = mod.fromMarkdown(props.markdown);
  /** The document last handed to `update` — by identity: ProseMirror keeps the same `Node` through a transaction with no steps. */
  let lastReportedDoc: unknown = initialDoc;

  handle = mod.mountEditor({
    dom: rootEl.value,
    doc: initialDoc,
    mention: {
      onStateChange: (state) => {
        mentionState.value = state;
        if (state.active && editorView) {
          const coords = editorView.coordsAtPos(state.from);
          mentionCaretRect.value = positionMenu(coords);
          mentionMismatch.value = null;
          if (state.query !== lastMentionQuery) {
            const query = state.query;
            lastMentionQuery = query;
            void searchMentions(query).then((candidates: MentionCandidate[]) => {
              // Two requests can answer in either order, and the slower one
              // is not always the older one: a fetch for `@a` landing behind
              // one for `@ab` repainted the menu with candidates for a query
              // the user had already typed past — the staleness
              // `reduceMentionState`'s `trigger` reset exists to prevent,
              // arriving after that reset has already run. Only the response
              // for the query still on screen may be rendered;
              // `lastMentionQuery` is null once the menu closes, so a
              // response that outlives its menu is discarded too.
              if (lastMentionQuery !== query) return;
              editorView?.dispatch(editorView.state.tr.setMeta(mod.mentionPluginKey, { type: 'setCandidates', candidates }));
            });
          }
        } else {
          mentionCaretRect.value = null;
          lastMentionQuery = null;
        }
      },
      onConfirmed: onMentionConfirmed,
    },
    slash: {
      onStateChange: (state) => {
        slashState.value = state;
        if (state.active && editorView) {
          const coords = editorView.coordsAtPos(state.from);
          slashCaretRect.value = positionMenu(coords);
        } else {
          slashCaretRect.value = null;
        }
      },
    },
    selection: {
      onChange: (report) => {
        selection.value = report;
      },
    },
    onUpdate: (view, update) => {
      transactionCount.value = update.transactionCount;
      emit('history', { undoDepth: update.undoDepth, redoDepth: update.redoDepth });
      // Only a transaction that changed the document is reported. A
      // selection-only transaction — a click, an arrow key, the toolbar's
      // own report — leaves `state.doc` the same instance, and reporting
      // it marked the buffer dirty and enabled Save before anything had
      // changed; `e2e/editor.spec.ts` then saved the pre-edit document
      // when a click landed inside the 300ms window (docs/TODO.md
      // Findings, 2026-09-16).
      if (view.state.doc === lastReportedDoc) return;
      lastReportedDoc = view.state.doc;
      if (debounceTimer) clearTimeout(debounceTimer);
      pendingReport = () => emit('update', mod.toMarkdown(view.state.doc));
      debounceTimer = setTimeout(flush, 300);
    },
  });
  editorView = handle.view;
  attached.value = true;
}

onMounted(() => {
  void mount();
});

onBeforeUnmount(() => {
  handle?.destroy();
});

/**
 * The bar's Undo and Redo, run through the handle — the same commands
 * `Mod-z` / `Shift-Mod-z` run inside the editor (`keymap.ts`) — and then
 * focus back where the caret is, so the next keystroke lands in the
 * document rather than on the button.
 */
function undo(): void {
  handle?.undo();
  editorView?.focus();
}

function redo(): void {
  handle?.redo();
  editorView?.focus();
}

defineExpose({
  focus: () => editorView?.focus(),
  undo,
  redo,
  flush,
});
</script>

<template>
  <div
    ref="hostEl"
    class="relative"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown="onHostKeydown"
    @keydown.capture="onHostKeydownCapture"
    @pointermove="onPointerMove"
    @pointerenter="cancelHandleHide"
    @pointerleave="scheduleHandleHide"
  >
    <!-- No frame. The document is not a control: nothing here draws a
         radius, a ring, a border or a fill. Until 2026-09-17 the global
         focus indicator (`main.css` §9, 3px `secondary` at 2px offset)
         landed on this contenteditable — Chrome treats a text-entry
         element as focus-visible on any focus, pointer included — and
         followed a `rounded-lg`, so the owner's screenshot showed a
         rounded box hugging the content and fighting the block handle in
         the margin. `main.css` §13 now relocates the indicator to the
         caret, in the `primary` role M3's text field gives it: the caret
         *is* the focus indicator of a text-entry surface (WCAG 2.4.7), so
         the ring is relocated, never removed (checklist §5). Edit mode is
         told by its surroundings — the condensed bar with a filled Save,
         "Editing" in the breadcrumb, the handle, the selection toolbar,
         the caret — not by a box (docs/UI-CHECKLIST.md Review Log,
         2026-09-17). Before that, a ring this component added itself was
         a *second* indicator beside the global one (2026-09-07).
         `min-h-64` rather than `min-h-[16rem]`: same 256px, on the scale
         instead of beside it (docs/UI-CHECKLIST.md §4.1).
         No canvas of its own: the document pane the workspace frame
         stands this on is already `bg-default`, §1.4's document canvas
         (docs/DESIGN-SYSTEM.md §8.3), so a `bg-default` box here was the
         same tone as its ground — invisible by construction (§9.4's
         corollary) — and its `p-4` inset was the one thing left between
         read and edit mode sharing the column: measured on 2026-09-07, a
         paragraph stood at x=310.5 in read mode and x=326.5 in edit. The
         text now stands where read mode's article stands, and
         `e2e/editor.spec.ts` holds the two to the pixel. `-m-4 p-4`: the
         surface still reaches 16px past the text on every side, so a
         click just beside the first character lands in the document and
         the block handle's hover band (`onPointerMove`) begins before the
         text does.
         `aria-activedescendant` is what connects the menus below to the
         element that actually holds focus — without it a screen-reader user
         gets no announcement as the arrow keys move the selection.
         `role="textbox"` + `aria-multiline` name what this contenteditable
         is; `aria-haspopup` / `aria-expanded` / `aria-controls` are the
         combobox-style chain from the textbox to the listbox it drives,
         so the options an arrow key lands on are announced as belonging
         to *this* editor (checklist §5; the audit of 2026-09-14 found an
         unnamed contenteditable with no relationship to its menus).
         `v-show`, not `v-if`: ProseMirror mounts into this element, so it
         must exist before the view does; it is only hidden until then,
         behind the skeleton below (`attached`). -->
    <!-- The page's skeleton, continued: the same `doc-body` text lines
         `pages/[id]/edit.vue` shows while the session is requested — the
         one `DocBodySkeleton` (§4.1) — kept up for the last stretch:
         chunk evaluation, the first parse, the view, so the box never
         stands empty between the two (docs/UI-CHECKLIST.md §3, "no layout
         shift on load"). -->
    <div v-if="!attached" data-testid="editor-skeleton" aria-hidden="true">
      <DocBodySkeleton />
    </div>
    <div
      v-show="attached"
      ref="rootEl"
      class="doc-body text-doc-body text-default prosemirror-editor -m-4 min-h-64 p-4"
      data-testid="editor-surface"
      :data-transactions="transactionCount"
      role="textbox"
      aria-multiline="true"
      aria-label="Page content"
      aria-haspopup="listbox"
      :aria-expanded="openMenuId ? 'true' : 'false'"
      :aria-controls="openMenuId"
      :aria-activedescendant="activeOptionId"
    />

    <!-- @ mention and / slash menus. Both are `corner-medium` (12px):
         §3.4's two-rung direction lists menus under *controls*, and every
         menu the library renders (`UDropdownMenu`) is `rounded-md`. At
         `rounded-lg` these two were the only 16px menus in the app.
         Row hover is the `dw-state-layer` — a `currentColor` overlay at
         M3's 0.08 (§5.2) — not a step to another surface rung. The
         `hover:bg-elevated` they used to carry moved *away* from the menu's
         own `bg-accented` in opposite directions per theme: measured
         oklch(0.93103) → oklch(0.94828) in light (lighter) and
         oklch(0.32759) → oklch(0.28448) in dark (darker), which is exactly
         the "depends on the background being light or dark" failure
         checklist §4.2 names. The selected row keeps its opaque
         `secondary-container` fill, so selected and hovered stay
         unmistakably different (§4.6). -->
    <!-- @ mention menu: `MentionMenu`, shared with the comment composer
         (§4.1). Rows confirm on click as well as on Enter; the menu keeps
         focus in the editor across the click. -->
    <MentionMenu
      v-if="mentionState?.active"
      :id="MENTION_MENU_ID"
      :candidates="mentionState.candidates"
      :selected-index="mentionState.selectedIndex"
      :query="mentionState.query"
      option-id-prefix="dw-mention-option-"
      :position="mentionCaretRect"
      @select="confirmMentionAt"
    />

    <!-- The block handle: one, beside the hovered block, gone otherwise —
         the measure column carries no permanent chrome. -->
    <EditorBlockHandle
      v-if="hoveredBlock"
      v-model:open="tunesOpen"
      :top="hoveredBlock.top"
      :items="tunesItems"
      :modifier-name="modifierName"
      @drag-start="onHandleDragStart"
      @drag-end="onHandleDragEnd"
      @closed="onTunesClosed"
      @pointer-enter="cancelHandleHide"
      @pointer-leave="scheduleHandleHide"
    />

    <!-- The selection toolbar: the one formatting chrome, and only while
         there is a range to format — nothing permanent stands inside the
         measure column (PRODUCT.md, principle 6). -->
    <EditorSelectionToolbar
      v-if="toolbarVisible && selection"
      ref="selectionToolbar"
      :marks="selection.marks"
      :link="selection.link"
      :position="toolbarPosition"
      @toggle="onToolbarToggle"
      @set-link="onToolbarSetLink"
      @unset-link="onToolbarUnsetLink"
      @link-open="linkPopoverOpen = $event"
      @close="focusEditor"
    />

    <!-- The chip tier (`InlineNotice`): one line about the editor above it. -->
    <InlineNotice v-if="mentionMismatch" tier="chip" tone="error" role="alert" class="mt-2">
      {{ mentionMismatch }}
    </InlineNotice>

    <!-- / slash command menu — same ownership and click wiring as above. -->
    <div
      v-if="slashState?.active"
      :id="SLASH_MENU_ID"
      role="listbox"
      aria-label="Block commands"
      class="fixed z-10 min-w-64 rounded-md bg-accented p-1 shadow-lg ring ring-default"
      :style="slashCaretRect ? { top: `${slashCaretRect.top}px`, left: `${slashCaretRect.left}px` } : {}"
    >
      <p v-if="slashState.commands.length === 0" class="px-3 py-2 text-body-small text-muted">No matching commands</p>
      <ul v-else role="presentation">
        <li
          v-for="(command, index) in slashState.commands"
          :id="`dw-slash-option-${index}`"
          :key="command.id"
          role="option"
          :aria-selected="index === slashState.selectedIndex"
          class="dw-state-layer flex cursor-pointer items-start gap-2 rounded-md px-3 py-2"
          :class="index === slashState.selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default'"
          @mousedown.prevent
          @click="confirmSlashAt(index)"
        >
          <!-- The icon beside the label, never instead of it (§4.3), from
               the one map "Turn into" reads too (`utils/block-tunes.ts`). -->
          <span class="flex h-5 shrink-0 items-center"><UIcon :name="slashCommandIcon(command.id)" class="size-4" aria-hidden="true" /></span>
          <span>
            <span class="block text-body-medium">{{ command.label }}</span>
            <span class="block text-body-small text-muted">{{ command.description }}</span>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

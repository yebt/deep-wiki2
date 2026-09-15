<script setup lang="ts">
/**
 * The WYSIWYG editing surface (document-editor spec). Dynamically imports
 * `@deep-wiki/editor/mount` — never a static import — so this component
 * itself can be statically imported by the edit route while the actual
 * ProseMirror-view bundle only loads once this component mounts (which
 * only happens once edit mode is actually entered).
 * `scripts/checks/bundle-isolation.ts` enforces the "no static import of
 * `/mount`" half of this; the read route never imports this component at
 * all, which is the other half. Arrow-key selection movement, Escape and
 * Enter are all handled inside the plugins themselves
 * (`packages/editor/src/mount/{mention,slash}-plugin.ts`) — this
 * component only renders whatever state they report and supplies the two
 * things a ProseMirror plugin cannot reach itself: fetching mention
 * candidates over the network, and the access-mismatch check.
 */
import { fromMarkdown, toMarkdown } from '@deep-wiki/editor';
import type { MentionCandidate, MentionState, SlashState } from '@deep-wiki/editor';
import type { EditorView } from 'prosemirror-view';
import { positionMenu } from '~/utils/menu-position';

const props = defineProps<{
  markdown: string;
  workspaceId: string;
  pageId: string;
}>();

const emit = defineEmits<{
  update: [markdown: string];
}>();

const rootEl = ref<HTMLElement | null>(null);
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

let editorView: EditorView | undefined;
/** The `"./mount"` module, kept from the dynamic import so the click paths below can build the same transactions the plugins build on Enter. */
let editorModule: typeof import('@deep-wiki/editor/mount') | undefined;

const { search: searchMentions, checkAccess } = useMentionCandidates(props.workspaceId, props.pageId);

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
  const mod = await import('@deep-wiki/editor/mount');
  editorModule = mod;
  if (!rootEl.value) return;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMentionQuery: string | null = null;

  editorView = mod.createEditorView({
    dom: rootEl.value,
    doc: fromMarkdown(props.markdown),
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
    onUpdate: (view) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => emit('update', toMarkdown(view.state.doc)), 300);
    },
  });
}

onMounted(() => {
  void mount();
});

onBeforeUnmount(() => {
  editorView?.destroy();
});

defineExpose({
  focus: () => editorView?.focus(),
});
</script>

<template>
  <div class="relative">
    <!-- No `focus-within:ring-*` here. `main.css` declares the focus
         indicator unlayered — 3px `secondary` at 2px offset — so it lands
         on the editor when it takes focus like it lands on every other
         control. The ring this used to add was a *second*, 2px `primary`
         indicator drawn at the same time: measured on 2026-09-07, a focused
         editor carried both, in two different roles and two widths.
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
         box still reaches 16px past the text on every side, so the focus
         indicator — 3px at 2px offset, main.css — does not hug the
         first character the way it would on a bare column.
         `aria-activedescendant` is what connects the menus below to the
         element that actually holds focus — without it a screen-reader user
         gets no announcement as the arrow keys move the selection.
         `role="textbox"` + `aria-multiline` name what this contenteditable
         is; `aria-haspopup` / `aria-expanded` / `aria-controls` are the
         combobox-style chain from the textbox to the listbox it drives,
         so the options an arrow key lands on are announced as belonging
         to *this* editor (checklist §5; the audit of 2026-09-14 found an
         unnamed contenteditable with no relationship to its menus). -->
    <div
      ref="rootEl"
      class="doc-body text-doc-body text-default prosemirror-editor -m-4 min-h-64 rounded-lg p-4"
      data-testid="editor-surface"
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
    <!-- @ mention menu. The `<ul>` between the listbox and its options is
         `role="presentation"`, so the options are the listbox's own
         children to assistive technology. Rows confirm on click as well as
         on Enter; `mousedown.prevent` keeps focus in the editor across the
         click (the menu is outside the contenteditable). -->
    <div
      v-if="mentionState?.active"
      :id="MENTION_MENU_ID"
      role="listbox"
      aria-label="Mention suggestions"
      class="fixed z-10 min-w-56 rounded-md bg-accented p-1 shadow-lg ring ring-default"
      :style="mentionCaretRect ? { top: `${mentionCaretRect.top}px`, left: `${mentionCaretRect.left}px` } : {}"
    >
      <p v-if="mentionState.query === '' && mentionState.candidates.length === 0" class="px-3 py-2 text-body-small text-muted">
        Type to search people and pages…
      </p>
      <p v-else-if="mentionState.candidates.length === 0" class="px-3 py-2 text-body-small text-muted">No matches</p>
      <ul v-else role="presentation">
        <li
          v-for="(candidate, index) in mentionState.candidates"
          :id="`dw-mention-option-${index}`"
          :key="candidate.id"
          role="option"
          :aria-selected="index === mentionState.selectedIndex"
          class="dw-state-layer flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body-medium"
          :class="index === mentionState.selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default'"
          @mousedown.prevent
          @click="confirmMentionAt(index)"
        >
          <UIcon :name="candidate.type === 'page' ? 'i-lucide-file-text' : 'i-lucide-user'" class="size-4 shrink-0" aria-hidden="true" />
          {{ candidate.label }}
        </li>
      </ul>
    </div>

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
          class="dw-state-layer cursor-pointer rounded-md px-3 py-2"
          :class="index === slashState.selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default'"
          @mousedown.prevent
          @click="confirmSlashAt(index)"
        >
          <p class="text-body-medium">{{ command.label }}</p>
          <p class="text-body-small text-muted">{{ command.description }}</p>
        </li>
      </ul>
    </div>
  </div>
</template>

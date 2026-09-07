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

let editorView: EditorView | undefined;

const { search: searchMentions, checkAccess } = useMentionCandidates(props.workspaceId, props.pageId);

/**
 * `coordsAtPos()` returns viewport-relative coordinates, which is exactly
 * what a `position: fixed` element needs directly — no ancestor-offset
 * math (docs/UI-CHECKLIST.md §4.6: "Menus reposition to stay in the
 * viewport near the bottom or right edge… never render clipped or
 * off-screen"). `MENU_HEIGHT_ESTIMATE`/`MENU_WIDTH_ESTIMATE` are the
 * menus' own `min-w-*` plus a handful of rows — real content can be
 * shorter, never taller by more than a row or two, so flipping a little
 * early is the safe direction to be wrong in.
 */
const MENU_HEIGHT_ESTIMATE = 220;
const MENU_WIDTH_ESTIMATE = 260;

function positionMenu(coords: { top: number; bottom: number; left: number }): { top: number; left: number } {
  const spaceBelow = window.innerHeight - coords.bottom;
  const top = spaceBelow < MENU_HEIGHT_ESTIMATE ? Math.max(8, coords.top - MENU_HEIGHT_ESTIMATE) : coords.bottom + 4;
  const left = Math.min(coords.left, window.innerWidth - MENU_WIDTH_ESTIMATE - 8);
  return { top, left: Math.max(8, left) };
}

async function mount(): Promise<void> {
  const mod = await import('@deep-wiki/editor/mount');
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
            lastMentionQuery = state.query;
            void searchMentions(state.query).then((candidates: MentionCandidate[]) => {
              editorView?.dispatch(editorView.state.tr.setMeta(mod.mentionPluginKey, { type: 'setCandidates', candidates }));
            });
          }
        } else {
          mentionCaretRect.value = null;
          lastMentionQuery = null;
        }
      },
      onConfirmed: (candidate) => {
        if (candidate.type !== 'user') return;
        void checkAccess(candidate.id).then((canRead) => {
          mentionMismatch.value = canRead ? null : `${candidate.label} does not have access to this page yet — mentioning them does not grant it.`;
        });
      },
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
         `aria-activedescendant` is what connects the menus below to the
         element that actually holds focus — without it a screen-reader user
         gets no announcement as the arrow keys move the selection. -->
    <div
      ref="rootEl"
      class="doc-body text-doc-body text-default prosemirror-editor min-h-64 rounded-lg bg-default p-4"
      data-testid="editor-surface"
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
    <!-- @ mention menu -->
    <div
      v-if="mentionState?.active"
      role="listbox"
      aria-label="Mention suggestions"
      class="fixed z-10 min-w-56 rounded-md bg-accented p-1 shadow-lg ring ring-default"
      :style="mentionCaretRect ? { top: `${mentionCaretRect.top}px`, left: `${mentionCaretRect.left}px` } : {}"
    >
      <p v-if="mentionState.query === '' && mentionState.candidates.length === 0" class="px-3 py-2 text-body-small text-muted">
        Type to search people and pages…
      </p>
      <p v-else-if="mentionState.candidates.length === 0" class="px-3 py-2 text-body-small text-muted">No matches</p>
      <ul v-else>
        <li
          v-for="(candidate, index) in mentionState.candidates"
          :id="`dw-mention-option-${index}`"
          :key="candidate.id"
          role="option"
          :aria-selected="index === mentionState.selectedIndex"
          class="dw-state-layer flex items-center gap-2 rounded-md px-3 py-2 text-body-medium"
          :class="index === mentionState.selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default'"
        >
          <UIcon :name="candidate.type === 'page' ? 'i-lucide-file-text' : 'i-lucide-user'" class="size-4 shrink-0" aria-hidden="true" />
          {{ candidate.label }}
        </li>
      </ul>
    </div>

    <p v-if="mentionMismatch" role="alert" class="mt-2 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container">
      {{ mentionMismatch }}
    </p>

    <!-- / slash command menu -->
    <div
      v-if="slashState?.active"
      role="listbox"
      aria-label="Block commands"
      class="fixed z-10 min-w-64 rounded-md bg-accented p-1 shadow-lg ring ring-default"
      :style="slashCaretRect ? { top: `${slashCaretRect.top}px`, left: `${slashCaretRect.left}px` } : {}"
    >
      <p v-if="slashState.commands.length === 0" class="px-3 py-2 text-body-small text-muted">No matching commands</p>
      <ul v-else>
        <li
          v-for="(command, index) in slashState.commands"
          :id="`dw-slash-option-${index}`"
          :key="command.id"
          role="option"
          :aria-selected="index === slashState.selectedIndex"
          class="dw-state-layer rounded-md px-3 py-2"
          :class="index === slashState.selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default'"
        >
          <p class="text-body-medium">{{ command.label }}</p>
          <p class="text-body-small text-muted">{{ command.description }}</p>
        </li>
      </ul>
    </div>
  </div>
</template>

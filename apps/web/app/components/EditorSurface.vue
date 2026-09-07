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
    <div
      ref="rootEl"
      class="doc-body text-doc-body text-default prosemirror-editor min-h-[16rem] rounded-lg bg-default p-4 outline-none focus-within:ring-2 focus-within:ring-primary"
      data-testid="editor-surface"
    />

    <!-- @ mention menu -->
    <div
      v-if="mentionState?.active"
      role="listbox"
      aria-label="Mention suggestions"
      class="fixed z-10 min-w-56 rounded-lg bg-accented p-1 shadow-lg ring ring-default"
      :style="mentionCaretRect ? { top: `${mentionCaretRect.top}px`, left: `${mentionCaretRect.left}px` } : {}"
    >
      <p v-if="mentionState.query === '' && mentionState.candidates.length === 0" class="px-3 py-2 text-body-small text-muted">
        Type to search people and pages…
      </p>
      <p v-else-if="mentionState.candidates.length === 0" class="px-3 py-2 text-body-small text-muted">No matches</p>
      <ul v-else>
        <li
          v-for="(candidate, index) in mentionState.candidates"
          :key="candidate.id"
          role="option"
          :aria-selected="index === mentionState.selectedIndex"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-body-medium"
          :class="index === mentionState.selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default hover:bg-elevated'"
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
      class="fixed z-10 min-w-64 rounded-lg bg-accented p-1 shadow-lg ring ring-default"
      :style="slashCaretRect ? { top: `${slashCaretRect.top}px`, left: `${slashCaretRect.left}px` } : {}"
    >
      <p v-if="slashState.commands.length === 0" class="px-3 py-2 text-body-small text-muted">No matching commands</p>
      <ul v-else>
        <li
          v-for="(command, index) in slashState.commands"
          :key="command.id"
          role="option"
          :aria-selected="index === slashState.selectedIndex"
          class="rounded-md px-3 py-2"
          :class="index === slashState.selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default hover:bg-elevated'"
        >
          <p class="text-body-medium">{{ command.label }}</p>
          <p class="text-body-small text-muted">{{ command.description }}</p>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The tree's one editable row: a name typed where the row lives.
 *
 * The owner rejected the tree's modal create and rename on 2026-09-23 and
 * asked for VS Code's pattern instead — an input box drawn *in* the row, at
 * the nesting depth the node will have, Enter to confirm and Escape to
 * cancel (`explorerViewer.ts`'s `renderInputBox`, which backs creation and
 * rename alike; this batch's research report has the citation). This
 * component is that box, and it is one component because it is used twice:
 * as a draft row inserted under the parent a creation names, and in place
 * of an existing row's title during a rename. Two copies of a field that
 * owns focus, keys and a refusal is exactly the defect
 * docs/UI-CHECKLIST.md §4.1 names.
 *
 * ── What it owes the tree around it ────────────────────────────────────
 *
 * The tree is an ARIA tree with a roving tabindex, arrow-key movement and
 * Enter to open a page (§5, and `NavigationTreeNode`'s own contract). Every
 * one of those keys is a key a person typing a name will press, so the
 * editor marks itself `data-row-editor` — which `NavigationTreeNode`'s
 * `onKeydown` checks before reporting a press to the tree — and stops the
 * two keys it answers itself. Pointer events are stopped for the same
 * reason: a click in the field is not a click on the row, and a row that
 * is being named is not draggable.
 *
 * ── The field's metrics ────────────────────────────────────────────────
 *
 * `h-10` — 40px, the tree row's own height (docs/DESIGN-SYSTEM.md §7.2),
 * the same metric the tree's filter box already takes for the same reason
 * (that file's §14, 2026-09-16: a 56px content-area field in a 280px pane
 * reads as a form control that wandered into the furniture). It is exactly
 * the height of the row it replaces, so nothing above or below it moves
 * when the field appears (§3, "no layout shift"). The text stays 16px
 * (`size="xl"`, §9.5 — below 16px iOS Safari zooms on focus) and the shape
 * `rounded-md` (§3.4, controls at `corner-medium`), both inherited.
 *
 * A refusal the person can fix by typing stands *under* the field rather
 * than beside it: 280px of pane has no room beside a 40px field, and the
 * sentence is a whole sentence rather than a truncated one. The field
 * points at it with `aria-describedby`, so it is read as part of the field
 * and not as a stray paragraph (§5).
 */
import { NODE_TYPE_ICONS, NODE_TYPE_LABELS } from '~/composables/useTreeRowActions';
import type { EditorSnapshot } from '~/composables/useTreeRowEditor';

const props = defineProps<{
  /** The state machine's one snapshot: what is being named, the phase, the value, the refusal. */
  snapshot: EditorSnapshot;
  /** The indent the row stands at — `NavigationTreeNode`'s `depth * 12 + 8` (DESIGN-SYSTEM §7.2). */
  depth: number;
  /** A container's rows carry a chevron; a spacer keeps the field's left edge where the title's was. */
  hasChevron?: boolean;
}>();

const emit = defineEmits<{
  'update:value': [value: string];
  commit: [];
  cancel: [];
}>();

const fieldId = useId();
const errorId = `${fieldId}-error`;
const hintId = `${fieldId}-hint`;

const draft = computed(() => props.snapshot.draft);

/**
 * The name says what is being named, because a screen-reader user hears the
 * field and not the row it stands in (§5, the same reasoning that made the
 * menu's history item "Page history" rather than "History").
 */
const label = computed(() =>
  draft.value.mode === 'create'
    ? `Name of the new ${NODE_TYPE_LABELS[draft.value.type].toLowerCase()}`
    : `Rename “${draft.value.originalTitle}”`,
);

const icon = computed(() => NODE_TYPE_ICONS[draft.value.type] ?? 'i-lucide-file');
const isCommitting = computed(() => props.snapshot.phase === 'committing');

const input = ref<{ inputRef?: HTMLInputElement | null } | null>(null);

/**
 * The field takes focus the moment it exists, and a rename opens with the
 * whole name selected so typing replaces it — VS Code selects the basename
 * of a file and the whole name of a directory, and a wiki title has no
 * extension to exclude.
 */
onMounted(() => {
  void nextTick(() => {
    const el = input.value?.inputRef;
    if (!el) return;
    el.focus();
    el.select();
  });
});
</script>

<template>
  <div
    data-row-editor
    class="flex flex-col gap-1 pe-1"
    :style="{ paddingLeft: `${depth * 12 + 8}px` }"
    @click.stop
    @mousedown.stop
    @dblclick.stop
  >
    <div class="flex h-10 min-h-10 items-center gap-2">
      <!-- The chevron's width, kept but not drawn: a row being renamed is a
           field, not a disclosure, and the field must start where the title
           it replaces started. -->
      <span v-if="hasChevron" class="size-4 shrink-0" aria-hidden="true" />
      <UIcon :name="icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <UInput
        :id="fieldId"
        ref="input"
        :model-value="snapshot.value"
        :aria-label="label"
        :aria-describedby="snapshot.error ? errorId : hintId"
        :aria-busy="isCommitting ? 'true' : undefined"
        :loading="isCommitting"
        autocomplete="off"
        spellcheck="false"
        class="min-w-0 flex-1"
        :ui="{ base: 'h-10' }"
        @update:model-value="emit('update:value', String($event))"
        @keydown.enter.prevent.stop="emit('commit')"
        @keydown.escape.prevent.stop="emit('cancel')"
        @keydown.stop
      />
    </div>

    <!-- A name that is already taken: the server's own sentence, the typed
         text still in the field, and nothing renamed behind the person's
         back (§3 — an error states what failed and offers the next action,
         which here is simply to type a different name). -->
    <p
      v-if="snapshot.error"
      :id="errorId"
      role="alert"
      data-testid="tree-row-editor-error"
      class="rounded-md bg-error-container px-2 py-1 text-body-small text-on-error-container"
    >
      {{ snapshot.error }}
    </p>
    <p :id="hintId" class="sr-only">Press Enter to confirm, or Escape to cancel.</p>
  </div>
</template>

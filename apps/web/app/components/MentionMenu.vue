<script setup lang="ts">
/**
 * The `@` mention menu — one component for the two places a person types
 * a mention: the editor (`EditorSurface`, driven by a ProseMirror plugin)
 * and the comment composer (`CommentComposer`, driven by a plain textarea
 * and `utils/mention-trigger.ts`). docs/UI-CHECKLIST.md §4.1: anything
 * on more than one screen is one component, because two copies do not
 * stay identical — and §4.6's keyboard contract is the part that would
 * have drifted first.
 *
 * Presentational: the owner holds the state (the query, the candidates,
 * the selected index) and the keyboard, because the keys land on the
 * element that holds focus — the contenteditable or the textarea — never
 * on this menu. The owner's `aria-activedescendant` names
 * `${optionIdPrefix}${index}`, which is the only wire between the
 * focused element and a listbox rendered outside it (§5).
 *
 * `corner-medium` (12px), `bg-accented`, `shadow-lg`: §3.4 lists menus
 * under controls and §9.6 puts every floating surface on
 * `surface-container-high`. Row hover is the `dw-state-layer`; the
 * selected row keeps its opaque `secondary-container` fill so selected
 * and hovered stay unmistakably different (§4.6, measured 2026-09-07).
 * `mousedown.prevent` keeps focus where the typing is across a click.
 */
import type { MentionCandidate } from '@deep-wiki/editor';

withDefaults(
  defineProps<{
    id: string;
    candidates: readonly MentionCandidate[];
    selectedIndex: number;
    query: string;
    /** `${optionIdPrefix}${index}` is each option's id — what the owner's `aria-activedescendant` names. */
    optionIdPrefix: string;
    /** Viewport coordinates for a menu at the caret (`fixed`); `null` lets the owner place it in flow (`absolute`, below a textarea). */
    position?: { top: number; left: number } | null;
  }>(),
  { position: null },
);

const emit = defineEmits<{ select: [index: number] }>();
</script>

<template>
  <div
    :id="id"
    role="listbox"
    aria-label="Mention suggestions"
    class="z-10 min-w-56 rounded-md bg-accented p-1 shadow-lg ring ring-default"
    :class="position ? 'fixed' : 'absolute'"
    :style="position ? { top: `${position.top}px`, left: `${position.left}px` } : undefined"
  >
    <p v-if="query === '' && candidates.length === 0" class="px-3 py-2 text-body-small text-muted">Type to search people and pages…</p>
    <p v-else-if="candidates.length === 0" class="px-3 py-2 text-body-small text-muted">No matches</p>
    <!-- `role="presentation"` on the `<ul>`: the options are the listbox's
         own children to assistive technology. -->
    <ul v-else role="presentation">
      <li
        v-for="(candidate, index) in candidates"
        :id="`${optionIdPrefix}${index}`"
        :key="candidate.id"
        role="option"
        :aria-selected="index === selectedIndex"
        class="dw-state-layer flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body-medium"
        :class="index === selectedIndex ? 'bg-secondary-container text-on-secondary-container' : 'text-default'"
        @mousedown.prevent
        @click="emit('select', index)"
      >
        <UIcon :name="candidate.type === 'page' ? 'i-lucide-file-text' : 'i-lucide-user'" class="size-4 shrink-0" aria-hidden="true" />
        {{ candidate.label }}
      </li>
    </ul>
  </div>
</template>

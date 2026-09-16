<script setup lang="ts">
/**
 * The marks beside anchored blocks — the comment overlay's visible half
 * (comment-overlay spec: "The Client Composes Indicators Onto Unchanged
 * Cached HTML"; docs/UI-CHECKLIST.md §4.7) — and, beside every other
 * block, the way to start a thread. Presentational: `useBlockPlacement`
 * decides where a mark or a slot goes and `usePageComments` what a mark
 * counts; this draws them.
 *
 * ## Where it stands
 *
 * The reading column is the shell's and measures 658.9px at x=310.5 on
 * every product screen (§6 — measured, not assumed). A gutter that
 * widened the column, or pushed the prose over to make room, would move
 * the text under every reader's eye on the pages that happen to carry
 * comments. So the gutter is absolutely positioned against the wrapper the
 * screen makes `relative`, and from `md` up it sits **outside** the
 * column's right edge — `left-full` plus 8px — in the margin the centred
 * column leaves free (55px at 768, 310px at 1280). Below `md` there is no
 * margin to stand in (16px at 320), so the marks sit inside the column's
 * right edge and the screen gives the article 40px of end padding while
 * a mark exists — the one width the prose gives up, only at widths where
 * it already gives up most things, and only on pages that have comments.
 *
 * ## What a mark is
 *
 * A 32px icon-only control (§7.2's chrome height; §5's 24px target with
 * room to spare), which §4.3 permits only with **both** an accessible name
 * and a tooltip — so it carries both, and the name says the count in
 * words. Several threads on one block collapse into one mark whose count
 * is their reply-inclusive total (§4.7, "they collapse with a count"),
 * shown as M3's numbered badge — `UChip` in Nuxt UI's inverted naming
 * (§9.7) — once it exceeds one. Hover, focus and press are `UButton`'s
 * own state layer; the mark whose block the panel is showing takes the
 * tonal fill, which is the one thing a container fill is for (§5.2:
 * selected/active), and says so with `aria-pressed`.
 *
 * ## What a "+" is
 *
 * The same 32px control beside a block that has no mark — every
 * paragraph and heading the render named (`utils/block-element.ts`) —
 * named "Comment on this block", tooltipped, opening the composer on
 * click. It is drawn quiet (`opacity-0`) and revealed while its block is
 * hovered (the screen tracks the pointer over the article and says which
 * block it is on) or the control itself is hovered or focused; a
 * hundred "+" at full weight beside a long page would be chrome louder
 * than the content (§4.4). Quiet is not gone: the control keeps its
 * place, its size and its name, so a keyboard reaches it exactly as it
 * reaches a mark. It is offered only when the API said the caller may
 * comment — `canComment` on the threads response — so a reader sees no
 * affordance at all, not an empty one (§3, "permission-denied … never a
 * silently empty list", and the comment-overlay spec's reader).
 *
 * ## Keyboard
 *
 * A long page has a control per block, so the gutter is one tab stop
 * with a roving tabindex, not a hundred: `ArrowDown`/`ArrowUp` move
 * between marks and "+" in document order, `Home`/`End` to the ends,
 * and the list says so in a description a screen reader is given (§4.1's
 * rule that a hand-rolled group owes the keyboard contract a library
 * primitive would bring; §5's "name the keys in the UI").
 */
import type { PlacedBlock, PlacedMark } from '~/composables/useBlockPlacement';

const props = defineProps<{
  marks: readonly PlacedMark[];
  /** Every commentable block on the page, in document order — where a thread could be started. */
  blocks: readonly PlacedBlock[];
  /** The block whose threads the panel is showing — its mark reads as pressed. */
  activeBlockId: string | null;
  /** The block the pointer is over — its "+" is revealed. */
  hoveredBlockId: string | null;
  /** Whether the caller may start a thread here (the API's `canComment`). */
  canStart: boolean;
}>();

const emit = defineEmits<{ open: [blockId: string]; start: [blockId: string] }>();

type Slot = { readonly kind: 'mark'; readonly blockId: string; readonly top: number; readonly count: number } | { readonly kind: 'start'; readonly blockId: string; readonly top: number };

/** Marks and "+" as one list in document order — the order the arrow keys walk. */
const slots = computed<readonly Slot[]>(() => {
  const marked = new Set(props.marks.map((mark) => mark.blockId));
  const all: Slot[] = props.marks.map((mark) => ({ kind: 'mark', blockId: mark.blockId, top: mark.top, count: mark.count }));
  if (props.canStart) {
    for (const block of props.blocks) {
      if (!marked.has(block.blockId)) all.push({ kind: 'start', blockId: block.blockId, top: block.top });
    }
  }
  return all.sort((a, b) => a.top - b.top);
});

function label(count: number): string {
  return count === 1 ? '1 comment on this block' : `${count} comments on this block`;
}

const keysId = useId();
const focusIndex = ref(0);
const list = useTemplateRef<HTMLElement>('list');

function focusSlot(index: number): void {
  const bounded = Math.max(0, Math.min(index, slots.value.length - 1));
  focusIndex.value = bounded;
  list.value?.querySelectorAll<HTMLElement>('button')[bounded]?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  const handlers: Record<string, () => void> = {
    ArrowDown: () => focusSlot(focusIndex.value + 1),
    ArrowUp: () => focusSlot(focusIndex.value - 1),
    Home: () => focusSlot(0),
    End: () => focusSlot(slots.value.length - 1),
  };
  const handler = handlers[event.key];
  if (!handler) return;
  event.preventDefault();
  handler();
}

watch(slots, (next) => {
  if (focusIndex.value >= next.length) focusIndex.value = Math.max(0, next.length - 1);
});
</script>

<template>
  <ul
    v-if="slots.length > 0"
    ref="list"
    aria-label="Comments beside the text"
    :aria-describedby="keysId"
    class="absolute inset-y-0 right-0 w-8 md:left-full md:right-auto md:ms-2"
    @keydown="onKeydown"
  >
    <li :id="keysId" class="sr-only">Use the arrow keys to move between blocks, Home and End for the first and last.</li>
    <li
      v-for="(slot, index) in slots"
      :key="slot.blockId"
      :data-testid="slot.kind === 'mark' ? 'comment-mark' : 'comment-start'"
      :data-revealed="slot.kind === 'start' ? String(hoveredBlockId === slot.blockId) : undefined"
      class="group absolute left-0"
      :style="{ top: `${slot.top}px` }"
      @focusin="focusIndex = index"
    >
      <UChip v-if="slot.kind === 'mark'" :text="slot.count" :show="slot.count > 1" color="primary" size="xl" inset>
        <UTooltip :text="label(slot.count)">
          <UButton
            square
            size="sm"
            :variant="activeBlockId === slot.blockId ? 'soft' : 'ghost'"
            :color="activeBlockId === slot.blockId ? 'primary' : 'neutral'"
            icon="i-lucide-message-square"
            :aria-label="label(slot.count)"
            :aria-pressed="activeBlockId === slot.blockId ? 'true' : 'false'"
            :tabindex="index === focusIndex ? 0 : -1"
            @click="emit('open', slot.blockId)"
          />
        </UTooltip>
      </UChip>
      <UTooltip v-else text="Comment on this block">
        <UButton
          square
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-lucide-message-square-plus"
          aria-label="Comment on this block"
          class="transition-opacity duration-150 ease-standard motion-reduce:transition-none"
          :class="hoveredBlockId === slot.blockId ? 'opacity-100' : 'opacity-0 hover:opacity-100 focus-visible:opacity-100'"
          :tabindex="index === focusIndex ? 0 : -1"
          @click="emit('start', slot.blockId)"
        />
      </UTooltip>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * The marks beside anchored blocks — the comment overlay's visible half
 * (comment-overlay spec: "The Client Composes Indicators Onto Unchanged
 * Cached HTML"; docs/UI-CHECKLIST.md §4.7). Presentational: `useBlockPlacement`
 * decides where a mark goes and `usePageComments` what it counts; this
 * draws them.
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
 * ## What it is not
 *
 * Not a place to start a thread: creating one from the read screen is
 * not in this batch (tasks.md 10.7 names display, reply and resolve), so
 * a block with no comments draws no mark and the gutter is absent
 * entirely — for a read-only caller that is also what the API returns.
 */
import type { PlacedMark } from '~/composables/useBlockPlacement';

defineProps<{
  marks: readonly PlacedMark[];
  /** The block whose threads the panel is showing — its mark reads as pressed. */
  activeBlockId: string | null;
}>();

const emit = defineEmits<{ open: [blockId: string] }>();

function label(mark: PlacedMark): string {
  return mark.count === 1 ? '1 comment on this block' : `${mark.count} comments on this block`;
}
</script>

<template>
  <ul
    v-if="marks.length > 0"
    aria-label="Comments beside the text"
    class="absolute inset-y-0 right-0 w-8 md:left-full md:right-auto md:ms-2"
  >
    <li
      v-for="mark in marks"
      :key="mark.blockId"
      data-testid="comment-mark"
      class="absolute left-0"
      :style="{ top: `${mark.top}px` }"
    >
      <UChip :text="mark.count" :show="mark.count > 1" color="primary" size="xl" inset>
        <UTooltip :text="label(mark)">
          <UButton
            square
            size="sm"
            :variant="activeBlockId === mark.blockId ? 'soft' : 'ghost'"
            :color="activeBlockId === mark.blockId ? 'primary' : 'neutral'"
            icon="i-lucide-message-square"
            :aria-label="label(mark)"
            :aria-pressed="activeBlockId === mark.blockId ? 'true' : 'false'"
            @click="emit('open', mark.blockId)"
          />
        </UTooltip>
      </UChip>
    </li>
  </ul>
</template>

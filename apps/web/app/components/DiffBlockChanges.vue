<script setup lang="ts">
/**
 * One page's block-level changes, for both diff screens (block-diff spec:
 * "Diff Reports Added, Removed, Modified, And Moved"; docs/UI-CHECKLIST.md
 * §4.7). `pages/pages/[id]/diff.vue` and `pages/books/[id]/diff.vue` both
 * render this and nothing of their own below the caption — one
 * component, not one copy per screen (§4.1). It began as the book-diff
 * screen's `BookDiffBlockChanges`; the page-diff screen joined it on
 * 2026-09-17, when the owner's review of gates 10.4/10.6 asked for "a
 * diff like GitHub's" (word-level marks, and a side-by-side option).
 *
 * **The block classes.** The removed-section / current-order split (a
 * removed block has no position in the after-document, so it cannot be
 * interleaved into it), the `afterPosition()` ordering, and the up/down
 * `moved`-direction from `fromSlot`/`toSlot` — "Moved up"/"Moved down",
 * never a bare "Moved", and a block that moved AND changed says both.
 * Moved is deliberately not a shade of added/removed/modified:
 * `secondary` sits on a different hue from the green/amber/red the other
 * three share, and the icon and label carry it too (§5, never colour
 * alone).
 *
 * **The row.** Every row — changed or not — stays on the neutral
 * `bg-default` inset (docs/DESIGN-SYSTEM.md §9.4: content inside a filled
 * `UCard variant="soft"` steps DOWN to `bg-default`; this sits inside
 * exactly that card on both screens) and the signal is a 4px
 * accent-coloured left border plus an `outline` badge — never `soft`,
 * which the 2026-09-14 audit measured at 1.00–1.09:1 on that card's
 * `bg-emphasized`. The page-diff screen used to paint a modified row's
 * whole background `warning-container`; a word mark on that wash would
 * have been a container on a container, so the wash went.
 *
 * **Inside an edited block** (`DiffInlineText`): the deleted and inserted
 * words as `<del>`/`<ins>` — unified, interleaved in one column; side by
 * side, a before column carrying the deletions and an after column the
 * insertions, as a two-column grid per row from `md` up. Below `md` the
 * side-by-side preference is honoured as one column (the control's own
 * tooltip says so): two 14px columns in 320px is two unreadable ones.
 * The choice is `useDiffLayout`'s cookie (`dw-diff-layout`), read before
 * the first render so the screen never flips after it has drawn; the
 * width is asked of `matchMedia` on mount — the server assumes `md` and
 * up, so a phone with a side-by-side cookie collapses one frame after
 * hydration rather than mismatching it.
 *
 * The legend is drawn once per screen, above the list, beside the
 * control.
 */
import type { InlineSegment } from './DiffInlineText.vue';

export interface BlockChangeWithText {
  readonly kind: 'added' | 'removed' | 'modified' | 'moved' | 'unchanged';
  readonly id: string;
  readonly slot?: number;
  readonly fromSlot?: number;
  readonly toSlot?: number;
  readonly splitFrom?: string;
  readonly mergedInto?: string;
  readonly moved?: boolean;
  readonly text: string;
  /** Word-level changes; only an edited block carries them (`InlineSegmentSchema`). Absent on a response from before they existed, in which case the text renders unmarked. */
  readonly segments?: readonly InlineSegment[];
}

const props = withDefaults(
  defineProps<{
    changes: readonly BlockChangeWithText[];
    /** The current-order list's accessible name — each screen's own words. */
    currentLabel?: string;
    /** The removed section's visible heading. */
    removedHeading?: string;
    /** The removed list's accessible name. */
    removedLabel?: string;
  }>(),
  {
    currentLabel: 'Current content, annotated with what changed',
    removedHeading: 'Removed since this point',
    removedLabel: 'Blocks removed since this point',
  },
);

type Kind = BlockChangeWithText['kind'];

interface ChangeMeta {
  readonly label: string;
  readonly icon: string;
  readonly color: 'success' | 'error' | 'warning' | 'secondary';
}

const KIND_META: Record<Exclude<Kind, 'unchanged'>, ChangeMeta> = {
  added: { label: 'Added', icon: 'i-lucide-plus', color: 'success' },
  removed: { label: 'Removed', icon: 'i-lucide-minus', color: 'error' },
  modified: { label: 'Modified', icon: 'i-lucide-pencil', color: 'warning' },
  moved: { label: 'Moved', icon: 'i-lucide-move', color: 'secondary' },
};

/** "down" when the block's new position is later in the document, "up" otherwise. `fromSlot`/`toSlot` are always distinct for `moved` and for `modified` with `moved: true` (block-diff spec). */
function movedDirection(fromSlot: number, toSlot: number): 'up' | 'down' {
  return toSlot > fromSlot ? 'down' : 'up';
}

/** The accent border colour utility for a changed row — never a background fill (see the component note above). */
const BORDER_CLASS: Record<Exclude<Kind, 'unchanged'>, string> = {
  added: 'border-success',
  removed: 'border-error',
  modified: 'border-warning',
  moved: 'border-secondary',
};

function borderClass(change: BlockChangeWithText): string {
  return change.kind === 'unchanged' ? 'border-transparent' : BORDER_CLASS[change.kind];
}

function badgeLabel(change: BlockChangeWithText): string {
  if (change.kind === 'unchanged') return '';
  if (change.kind === 'moved') {
    return movedDirection(change.fromSlot!, change.toSlot!) === 'down' ? 'Moved down' : 'Moved up';
  }
  if (change.kind === 'modified' && change.moved) {
    return movedDirection(change.fromSlot!, change.toSlot!) === 'down' ? 'Modified · moved down' : 'Modified · moved up';
  }
  return KIND_META[change.kind].label;
}

function badgeIcon(change: BlockChangeWithText): string {
  if (change.kind === 'unchanged') return '';
  if (change.kind === 'moved' || (change.kind === 'modified' && change.moved)) {
    return movedDirection(change.fromSlot!, change.toSlot!) === 'down' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up';
  }
  return KIND_META[change.kind].icon;
}

function badgeColor(change: BlockChangeWithText): ChangeMeta['color'] | undefined {
  return change.kind === 'unchanged' ? undefined : KIND_META[change.kind].color;
}

/** The after-document's own order: `slot` for added/unchanged, `toSlot` for anything that landed on the after side by moving or changing. */
function afterPosition(change: BlockChangeWithText): number {
  return change.kind === 'modified' || change.kind === 'moved' ? change.toSlot! : change.slot!;
}

const removedChanges = computed(() =>
  props.changes.filter((change) => change.kind === 'removed').toSorted((a, b) => a.slot! - b.slot!),
);

const currentChanges = computed(() =>
  props.changes.filter((change) => change.kind !== 'removed').toSorted((a, b) => afterPosition(a) - afterPosition(b)),
);

/** An edited block with the word-level segments to show; a modified block from an older response has none and renders as plain text. */
function inlineSegments(change: BlockChangeWithText): readonly InlineSegment[] | null {
  return change.kind === 'modified' && change.segments && change.segments.length > 0 ? change.segments : null;
}

// ---- Layout: the preference, and whether the width can honour it ----

const { layout, set } = useDiffLayout();

/** Tailwind's `md` (48rem): the width below which two columns of block text are two unreadable ones. */
const MD_QUERY = '(min-width: 48rem)';

// `true` until mounted: the server has no viewport and assumes `md` and
// up, and the first client render must agree with it (no hydration
// mismatch); the real answer replaces it one frame later.
const wide = ref(true);
let mediaQuery: MediaQueryList | null = null;
const onWidthChange = (event: MediaQueryListEvent): void => {
  wide.value = event.matches;
};
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return;
  mediaQuery = window.matchMedia(MD_QUERY);
  wide.value = mediaQuery.matches;
  mediaQuery.addEventListener('change', onWidthChange);
});
onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', onWidthChange);
});

const sideBySide = computed(() => layout.value === 'side-by-side' && wide.value);

const PRE_CLASS = 'overflow-x-auto font-mono text-body-medium whitespace-pre-wrap break-words text-default min-w-0';
/** The one grid, per row and for the column headings, so the two never disagree. */
const COLUMNS_CLASS = 'grid grid-cols-2 gap-4';
</script>

<template>
  <div class="space-y-6">
    <!-- The legend, once per screen, beside the layout control. `body-small
         text-muted`: docs/DESIGN-SYSTEM.md §9.8's trailing meta — a caption
         over the list, not a heading. The sample marks are the real marks,
         so the legend cannot drift from what it explains. -->
    <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p data-testid="diff-legend" class="text-body-small text-muted">
        In an edited block, <DiffInlineText :segments="[{ kind: 'inserted', text: 'inserted words' }]" /> and
        <DiffInlineText :segments="[{ kind: 'deleted', text: 'deleted words' }]" /> are marked.
      </p>
      <DiffLayoutControl :layout="layout" @change="set" />
    </div>

    <div v-if="removedChanges.length > 0">
      <p class="mb-2 text-label-large text-muted">{{ removedHeading }}</p>
      <ol :aria-label="removedLabel" class="space-y-2">
        <li
          v-for="change in removedChanges"
          :key="`removed-${change.id}`"
          class="rounded-md bg-default px-4 py-3 border-l-4"
          :class="borderClass(change)"
        >
          <p class="mb-2 flex">
            <UBadge variant="outline" :color="badgeColor(change)" :icon="badgeIcon(change)" size="sm">
              {{ badgeLabel(change) }}
            </UBadge>
          </p>
          <div v-if="sideBySide" :class="COLUMNS_CLASS">
            <pre :class="PRE_CLASS"><span class="sr-only">Before: </span>{{ change.text }}</pre>
            <p class="text-body-small text-muted">Not in the later revision.</p>
          </div>
          <pre v-else :class="PRE_CLASS">{{ change.text }}</pre>
        </li>
      </ol>
    </div>

    <div>
      <!-- Column headings for the side-by-side grid, once above the list;
           each cell also carries its own visually hidden prefix, so the
           heading row is for the eye only. -->
      <div v-if="sideBySide" :class="COLUMNS_CLASS" class="mb-2 px-4" aria-hidden="true">
        <p class="text-label-large text-muted">Before</p>
        <p class="text-label-large text-muted">After</p>
      </div>
      <ol :aria-label="currentLabel" class="space-y-2">
        <li
          v-for="change in currentChanges"
          :key="`current-${change.id}`"
          class="rounded-md bg-default px-4 py-3 border-l-4"
          :class="borderClass(change)"
        >
          <!-- In its own flex line, so the row's first line box is the
               badge's own height rather than the inherited strut's — what
               lets the page-diff skeleton draw the same box by construction. -->
          <p v-if="change.kind !== 'unchanged'" class="mb-2 flex">
            <UBadge variant="outline" :color="badgeColor(change)" :icon="badgeIcon(change)" size="sm">
              {{ badgeLabel(change) }}
            </UBadge>
          </p>

          <template v-if="sideBySide">
            <div v-if="inlineSegments(change)" :class="COLUMNS_CLASS">
              <pre :class="PRE_CLASS"><span class="sr-only">Before: </span><DiffInlineText :segments="inlineSegments(change)!" side="before" /></pre>
              <pre :class="PRE_CLASS"><span class="sr-only">After: </span><DiffInlineText :segments="inlineSegments(change)!" side="after" /></pre>
            </div>
            <div v-else-if="change.kind === 'added'" :class="COLUMNS_CLASS">
              <p class="text-body-small text-muted">Not in the earlier revision.</p>
              <pre :class="PRE_CLASS"><span class="sr-only">After: </span>{{ change.text }}</pre>
            </div>
            <!-- Unchanged, moved, and an edited block without segments:
                 the same text on both sides. -->
            <div v-else :class="COLUMNS_CLASS">
              <pre :class="PRE_CLASS"><span class="sr-only">Before: </span>{{ change.text }}</pre>
              <pre :class="PRE_CLASS"><span class="sr-only">After: </span>{{ change.text }}</pre>
            </div>
          </template>
          <pre v-else-if="inlineSegments(change)" :class="PRE_CLASS"><DiffInlineText :segments="inlineSegments(change)!" /></pre>
          <pre v-else :class="PRE_CLASS">{{ change.text }}</pre>
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Renders one page's block-level changes for the book-diff screen
 * (block-diff spec: "Diff Reports Added, Removed, Modified, And Moved";
 * docs/UI-CHECKLIST.md §4.7). `apps/web/app/pages/books/[id]/diff.vue`'s
 * own renderer.
 *
 * **Reused from `apps/web/app/pages/pages/[id]/diff.vue`:** the
 * removed-section / current-order split (a removed block has no position
 * in the after-document, so it cannot be interleaved into it), the
 * `afterPosition()` ordering, and the up/down `moved`-direction
 * computation from `fromSlot`/`toSlot`. The classification rules and the
 * "moved is never a shade of added/removed/modified" principle are
 * unchanged.
 *
 * **Changed, deliberately:** that screen paints every changed row's FULL
 * background in its kind's accent-container colour
 * (`bg-success-container`, `bg-error-container`, …) — the audit called
 * this "a highlighter pass over source". Here every row — changed or not
 * — stays on the neutral `bg-default` inset (docs/DESIGN-SYSTEM.md §9.4:
 * content inside a filled `UCard variant="soft"` steps DOWN to
 * `bg-default`, and this component is designed to sit inside exactly that
 * card on the diff screen) and the signal moves to a 4px accent-coloured
 * left border plus a badge. The badge variant is `outline`, never `soft`:
 * the audit measured `soft` at 1.00–1.09:1 (invisible) against a
 * `bg-emphasized` ancestor, and this component's own ancestor on the diff
 * screen is exactly that card. The result reads as "this line has a
 * marker", not "this whole line is stained a colour" — less coverage, the
 * same two-signal (icon + text) accessibility guarantee, and no repeat of
 * the audit's soft-on-emphasized collision.
 */
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
}

const props = defineProps<{ changes: readonly BlockChangeWithText[] }>();

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
</script>

<template>
  <div class="space-y-6">
    <div v-if="removedChanges.length > 0">
      <p class="mb-2 text-label-large text-muted">Removed since this point</p>
      <ol aria-label="Blocks removed since this point" class="space-y-2">
        <li
          v-for="change in removedChanges"
          :key="`removed-${change.id}`"
          class="rounded-md bg-default px-4 py-3 border-l-4"
          :class="borderClass(change)"
        >
          <UBadge variant="outline" :color="badgeColor(change)" :icon="badgeIcon(change)" size="sm" class="mb-2">
            {{ badgeLabel(change) }}
          </UBadge>
          <pre class="overflow-x-auto font-mono text-body-medium whitespace-pre-wrap break-words text-default">{{ change.text }}</pre>
        </li>
      </ol>
    </div>

    <ol aria-label="Current content, annotated with what changed" class="space-y-2">
      <li
        v-for="change in currentChanges"
        :key="`current-${change.id}`"
        class="rounded-md bg-default px-4 py-3 border-l-4"
        :class="borderClass(change)"
      >
        <UBadge v-if="change.kind !== 'unchanged'" variant="outline" :color="badgeColor(change)" :icon="badgeIcon(change)" size="sm" class="mb-2">
          {{ badgeLabel(change) }}
        </UBadge>
        <pre class="overflow-x-auto font-mono text-body-medium whitespace-pre-wrap break-words text-default">{{ change.text }}</pre>
      </li>
    </ol>
  </div>
</template>

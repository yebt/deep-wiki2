<script setup lang="ts">
/**
 * The thread panel — docs/UI-CHECKLIST.md §6's *contextual panel*
 * (comments / AI / presence), rendered as an overlay because the
 * three-pane shell does not exist yet (every product screen is one
 * centred column; recorded as a follow-up on 2026-09-07). §6 itself says
 * the panel "becomes an overlay" below 1280px, so on the medium and
 * narrow bands this is the specified behaviour, and on the wide band it
 * is the honest stand-in until the shell has a third pane to put it in.
 *
 * `USlideover`, never a hand-rolled drawer: it is Reka-backed and brings
 * the focus trap, focus return to the mark that opened it, and Escape
 * (§5, and §9.6 — "hand-rolling any of them forfeits checklist §5 and is
 * an automatic fail"). Its content is retargeted to `bg-accented`
 * (`surface-container-high`), the rung §9.6 gives every floating
 * surface — the same one `app.config.ts` gives modals and popovers. That
 * file is outside this batch's ownership, so the retarget is stated here
 * on the one slideover the product has, and recorded as a finding for
 * docs/TODO.md so it moves to `app.config.ts` beside the other three.
 *
 * ## Two views of one list
 *
 * Opened from a gutter mark, the panel shows **that block's** threads
 * and offers the rest ("Show all N"). Opened from one of the read
 * screen's chips — the orphan chip, or the "not placed yet" chip — it
 * shows **every** thread on the page. Both are the same list with a
 * filter, never two lists: an orphan is reachable only from the second
 * view, because no mark can point at a block that is gone (§4.7), which
 * is why the description always counts the detached ones out loud.
 *
 * Every thread renders open — root, replies, reply field, resolve —
 * rather than collapsed behind a disclosure: the panel scrolls, a
 * collapsed thread is one more click on every read, and §2's "a comment
 * thread with 60 replies" is handled by the panel's own scroll, which
 * `USlideover` gives its body.
 *
 * ## Announcements
 *
 * A failed write is a bar-tier `InlineNotice` (§4.1's three tiers —
 * this is the second) with `role="alert"`; a successful one lands in a
 * live region that is always in the DOM and only changes text, because
 * a region inserted at the moment its text appears is frequently not
 * announced at all (§5).
 */
import type { CommentThread } from '@deep-wiki/contracts';
import type { ThreadPlacement } from './CommentThreadItem.vue';

const props = defineProps<{
  open: boolean;
  threads: readonly CommentThread[];
  /** Show only this block's threads; `null` shows every thread on the page. */
  focusBlockId: string | null;
  /** Anchored threads whose block the cached render does not carry (design.md Decision 6, "no anchors known"). */
  unplacedBlockIds: readonly string[];
  busy: boolean;
  writeMessage: string | null;
  announcement: string;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  showAll: [];
  reply: [threadId: string, body: string];
  resolve: [threadId: string, resolved: boolean];
  locate: [blockId: string];
}>();

const visible = computed(() =>
  props.focusBlockId
    ? props.threads.filter((thread) => !thread.anchor.orphaned && thread.anchor.blockId === props.focusBlockId)
    : props.threads,
);

function placementOf(thread: CommentThread): ThreadPlacement {
  if (thread.anchor.orphaned) return 'orphaned';
  if (props.unplacedBlockIds.includes(thread.anchor.blockId)) return 'unplaced';
  return 'anchored';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const description = computed(() => {
  if (props.focusBlockId) {
    return `${plural(visible.value.length, 'comment')} on this block.`;
  }
  const orphaned = props.threads.filter((thread) => thread.anchor.orphaned).length;
  const unplaced = props.threads.filter((thread) => placementOf(thread) === 'unplaced').length;
  const parts = [`${plural(props.threads.length, 'comment')} on this page`];
  if (orphaned > 0) parts.push(`${orphaned} no longer attached to text`);
  if (unplaced > 0) parts.push(`${unplaced} not placed yet`);
  return `${parts.join(' · ')}.`;
});
</script>

<template>
  <USlideover
    :open="open"
    title="Comments"
    :description="description"
    :close="{ size: 'sm' }"
    :ui="{ content: 'bg-accented', body: 'space-y-4' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <p
        data-testid="comments-status"
        role="status"
        aria-live="polite"
        :class="announcement ? 'rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container' : 'sr-only'"
      >
        {{ announcement }}
      </p>

      <InlineNotice v-if="writeMessage" tier="bar" tone="error" role="alert" icon="i-lucide-circle-alert" title="That didn't go through">
        {{ writeMessage }}
      </InlineNotice>

      <div v-if="focusBlockId" class="flex justify-end">
        <UButton data-testid="comments-show-all" size="sm" variant="ghost" color="neutral" icon="i-lucide-list" @click="emit('showAll')">
          Show all {{ plural(threads.length, 'comment') }} on this page
        </UButton>
      </div>

      <ol aria-label="Comment threads, oldest first" class="space-y-4">
        <li v-for="thread in visible" :key="thread.id">
          <CommentThreadItem
            :thread="thread"
            :placement="placementOf(thread)"
            :busy="busy"
            @reply="(threadId, body) => emit('reply', threadId, body)"
            @resolve="(threadId, resolved) => emit('resolve', threadId, resolved)"
            @locate="(blockId) => emit('locate', blockId)"
          />
        </li>
      </ol>
    </template>
  </USlideover>
</template>

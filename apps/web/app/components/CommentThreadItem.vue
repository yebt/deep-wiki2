<script setup lang="ts">
/**
 * One comment thread — the root, its replies, and the two things a
 * subject with `comment` can do to it: reply and resolve (comment-threads
 * spec: "Threads And Resolution State"). Purely presentational;
 * `usePageComments` owns the writes and the panel owns the list.
 *
 * ## The three placements, one component
 *
 * A thread is the same object whether or not the page still has the text
 * it was written against, so the three states are one component with a
 * `placement` prop rather than three components that would drift:
 *
 * | Placement  | Meaning                                                                | What changes                                                    |
 * | ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
 * | `anchored` | The block is on screen, the gutter has a mark beside it                | "Show in page" scrolls to and highlights the block               |
 * | `orphaned` | Save-time reconciliation found no block for it (`anchor.orphaned`)     | A badge and one plain sentence: the text is gone, the excerpt stays |
 * | `unplaced` | The thread is anchored but the cached render carries no `data-block-id` | A badge and one plain sentence: not re-rendered yet (design.md D6)  |
 *
 * The excerpt — the text the comment was created against, captured at
 * creation and immutable (comment-threads spec) — renders in every
 * placement, because it is the only thing that still makes an orphan
 * readable. docs/UI-CHECKLIST.md §4.7: "a comment whose block was deleted
 * renders as an orphaned comment with its original quoted context —
 * never a crash, never a silently vanished thread".
 *
 * ## Ground and type
 *
 * The panel is a floating surface at `bg-accented` (docs/DESIGN-SYSTEM.md
 * §9.6), so a thread steps *down* to `bg-default` inside it (§9.4's
 * inset corollary) at the container radius (§3.4). The excerpt takes
 * §2.3's blockquote treatment — an `outline-variant` left rule and
 * `text-muted` — because that is what it is. Author is `label-large`,
 * the instant is `body-small` and carried in `<time datetime>` (§4.11,
 * `formatRevisionDate` — the viewer's own zone, named). Badges are
 * `outline`: the audit measured `soft` at 1.00–1.09:1 against an
 * emphasized ancestor and this panel's ground is one rung below that.
 *
 * ## Controls
 *
 * Reply is a labelled `UTextarea` (16px text — §9.5's iOS rule binds any
 * text entry) and a 32px `Reply`; Resolve/Reopen is a 32px outlined
 * neutral button. Both use `aria-disabled` while empty or busy, never
 * `disabled`, so the reason stays reachable by keyboard (§5).
 */
import type { CommentThread } from '@deep-wiki/contracts';
import { formatRevisionDate } from '../utils/format-revision-date';

export type ThreadPlacement = 'anchored' | 'orphaned' | 'unplaced';

const props = withDefaults(
  defineProps<{
    thread: CommentThread;
    placement: ThreadPlacement;
    /** A write on this page is in flight — controls stay in the tab order and explain themselves. */
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{
  reply: [threadId: string, body: string];
  resolve: [threadId: string, resolved: boolean];
  locate: [blockId: string];
}>();

const draft = ref('');
const canReply = computed(() => draft.value.trim().length > 0 && !props.busy);

function submitReply(): void {
  if (!canReply.value) return;
  emit('reply', props.thread.id, draft.value.trim());
  draft.value = '';
}

function toggleResolved(): void {
  if (props.busy) return;
  emit('resolve', props.thread.id, !props.thread.resolved);
}

function authorName(author: CommentThread['author']): string {
  return author.displayName ?? 'Unknown author';
}

const headingId = useId();
</script>

<template>
  <article :aria-labelledby="headingId" class="rounded-lg bg-default p-4" :data-comment-placement="placement">
    <!-- What this thread is about: its excerpt, and — when the text is no
         longer where it was — a badge plus one sentence saying so. -->
    <div class="mb-3">
      <div v-if="placement === 'orphaned'" class="mb-2">
        <UBadge variant="outline" color="warning" icon="i-lucide-unlink" size="sm">Text removed</UBadge>
        <p class="mt-2 text-body-small text-muted">
          The text this comment pointed at is no longer on this page. Its excerpt is kept here:
        </p>
      </div>
      <div v-else-if="placement === 'unplaced'" class="mb-2">
        <UBadge variant="outline" color="warning" icon="i-lucide-map-pin-off" size="sm">Not placed yet</UBadge>
        <p class="mt-2 text-body-small text-muted">
          This page's cached view predates block anchors, so this comment can't be shown beside its text until the page is re-rendered.
        </p>
      </div>
      <blockquote class="border-s-2 border-default ps-3 text-body-small text-muted">“{{ thread.anchor.quote }}”</blockquote>
      <UButton
        v-if="placement === 'anchored'"
        data-testid="comment-locate"
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-lucide-locate"
        class="mt-2"
        @click="emit('locate', thread.anchor.blockId)"
      >
        Show in page
      </UButton>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <p :id="headingId" class="text-label-large text-highlighted">{{ authorName(thread.author) }}</p>
      <!-- Colour is never the only signal (§5): the word and the icon. -->
      <UBadge v-if="thread.resolved" data-testid="comment-resolved" variant="outline" color="success" icon="i-lucide-check" size="sm">
        Resolved
      </UBadge>
    </div>
    <p class="text-body-small text-muted">
      <time :datetime="thread.createdAt">{{ formatRevisionDate(thread.createdAt) }}</time>
    </p>
    <p class="mt-2 text-body-medium text-default whitespace-pre-wrap">{{ thread.body }}</p>

    <ol v-if="thread.replies.length > 0" aria-label="Replies, oldest first" class="mt-3 space-y-3 border-s-2 border-default ps-3">
      <li v-for="reply in thread.replies" :key="reply.id" data-testid="comment-reply">
        <p class="text-label-large text-highlighted">{{ authorName(reply.author) }}</p>
        <p class="text-body-small text-muted">
          <time :datetime="reply.createdAt">{{ formatRevisionDate(reply.createdAt) }}</time>
        </p>
        <p class="mt-1 text-body-medium text-default whitespace-pre-wrap">{{ reply.body }}</p>
      </li>
    </ol>

    <!-- 16px above the form: the 4dp grid, one step below the 24px that
         separates two field groups (§7.4) — this is one field inside an
         object, not a form of its own. -->
    <UFormField label="Reply" class="mt-4">
      <UTextarea v-model="draft" :rows="2" autoresize class="w-full" :aria-disabled="busy || undefined" @keydown.ctrl.enter.prevent="submitReply" />
    </UFormField>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <UButton
        data-testid="comment-reply-submit"
        size="sm"
        icon="i-lucide-corner-down-left"
        :aria-disabled="!canReply || undefined"
        :title="canReply ? undefined : busy ? 'Waiting for the last change to finish.' : 'Write a reply first.'"
        @click="submitReply"
      >
        Reply
      </UButton>
      <UButton
        data-testid="comment-resolve"
        size="sm"
        variant="outline"
        color="neutral"
        :icon="thread.resolved ? 'i-lucide-rotate-ccw' : 'i-lucide-check'"
        :aria-disabled="busy || undefined"
        :title="busy ? 'Waiting for the last change to finish.' : undefined"
        @click="toggleResolved"
      >
        {{ thread.resolved ? 'Reopen' : 'Resolve' }}
      </UButton>
    </div>
  </article>
</template>

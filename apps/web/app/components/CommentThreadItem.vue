<script setup lang="ts">
/**
 * One comment thread — its subject, its conversation, and the two things a
 * subject with `comment` can do to it: reply and resolve (comment-threads
 * spec: "Threads And Resolution State"). Purely presentational;
 * `usePageComments` owns the writes and the panel owns the list.
 *
 * ## A conversation, not a record with a form stapled under it
 *
 * Rewritten 2026-09-23 on the owner's report ("así se ve feísimo", with a
 * screenshot of the panel as a database row: quoted excerpt, a locate
 * control, an author, a timestamp, a message, a nested reply box, then a
 * "Reply" label over an empty textarea with two buttons beneath it). The
 * shape it became, and why each part is where it is:
 *
 * | Part | Where | Why |
 * | --- | --- | --- |
 * | The excerpt | Top, as a blockquote, and it **is** the control that shows the text in the page | It is what the thread is *about* — a subject line, which is what every threaded conversation puts first. §2.3 gives a blockquote its treatment: an `outline-variant` left rule and `text-muted`. Word links the card to its anchor and Docs pairs it with the highlighted span; in both the quoted text is the thing you act on, so the separate "Show in page" button is gone (2026-09-23). |
 * | The messages | One `<ol>`, root and replies alike | The owner's "a reply is visibly inside the thread, not a second-class nested box". A reply is not a different kind of object from the comment that opened the thread, so it is not drawn as one: same avatar, same author line, same body, same classes — asserted in the test, so the two cannot drift apart. |
 * | Resolve | The header, beside the subject | The owner's "Resolve is a thread-level action and should read as one". Under the reply field it read as a second submit for the sentence being typed. |
 * | The reply field | Last, one line, grown on focus | The owner's "a quiet one-line affordance that grows when focused, not a permanently open box that dominates the panel". Several threads have to stack legibly in one panel, and a 3-row box per thread is what stopped them doing so. |
 *
 * ## The three placements, one component
 *
 * A thread is the same object whether or not the page still has the text
 * it was written against, so the three states are one component with a
 * `placement` prop rather than three components that would drift:
 *
 * | Placement  | Meaning                                                                | What changes                                                    |
 * | ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
 * | `anchored` | The block is on screen, the gutter has a mark beside it                | The subject offers to show the text in the page                  |
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
 * inset corollary) at the container radius (§3.4). An author is
 * `body-medium-emphasized` — the lead-in role §2.2 gives Emphasized, at
 * the dense-pane size §9.8 gives a list label, and the role the dashboard's
 * change rows already use for exactly this — and the avatar is `UAvatar`
 * with `initials()`, the treatment those rows and the presence chip already
 * carry (§4.1: one avatar idiom, not one per screen). The instant is
 * relative (`formatRelativeTime`, §4.11 as amended 2026-09-23) with the
 * absolute zone-named form as its title and the exact instant in `<time
 * datetime>`. Badges are `outline`: the audit measured `soft` at 1.00–1.09:1
 * against an emphasized ancestor and this panel's ground is one rung below
 * that.
 *
 * ## Controls
 *
 * Every control stays in the tab order while unavailable (`aria-disabled`
 * with the reason, never the attribute — §5) so a keyboard user can reach
 * the reason. A caller who may not comment (`canReply: false`) is offered
 * nothing at all rather than a disabled something: §3's "never a silently
 * empty list" has a twin, which is never a control with no honest enabled
 * state.
 */
import type { CommentThread } from '@deep-wiki/contracts';
import { formatRevisionDate } from '../utils/format-revision-date';
import { formatRelativeTime } from '../utils/relative-time';
import { initials } from '../utils/initials';

export type ThreadPlacement = 'anchored' | 'orphaned' | 'unplaced';

const props = withDefaults(
  defineProps<{
    thread: CommentThread;
    placement: ThreadPlacement;
    /** A write on this page is in flight — controls stay in the tab order and explain themselves. */
    busy?: boolean;
    /** Posted a moment ago and not yet confirmed by the server: shown and counted, not yet repliable. */
    pending?: boolean;
    /** Whether this caller may add to the thread at all (the API's `canComment`). */
    canReply?: boolean;
  }>(),
  { busy: false, pending: false, canReply: true },
);

const emit = defineEmits<{
  reply: [threadId: string, body: string];
  resolve: [threadId: string, resolved: boolean];
  /** Show this thread's anchored text in the page, and scroll to it if it is off screen. */
  locate: [blockId: string];
  /**
   * This thread is the one the reader is on — focus moved into it, or the
   * pointer entered it. The screen moves the document highlight to follow
   * (`useAnchorHighlight`), which is the tie Word draws between a card and
   * its anchor and Docs draws between a card and a highlighted span.
   */
  focusThread: [threadId: string];
}>();

const draft = ref('');
const canReplyNow = computed(() => draft.value.trim().length > 0 && !props.busy);
/** The reply affordance is one line until someone uses it; see the table above. */
const composing = ref(false);

function submitReply(): void {
  if (!canReplyNow.value) return;
  emit('reply', props.thread.id, draft.value.trim());
  draft.value = '';
  composing.value = false;
}

function toggleResolved(): void {
  if (props.busy) return;
  emit('resolve', props.thread.id, !props.thread.resolved);
}

/**
 * Focus leaving the composer entirely folds it again — unless there is a
 * draft in it, which must not be hidden behind a control the person then
 * has to find again. `relatedTarget` is read because focus moving from the
 * field to the Reply button beside it is focus *inside* the composer, and
 * folding there would take the button away under the pointer.
 */
function onComposerFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(next)) return;
  composing.value = draft.value.trim().length > 0;
}

/** A name every message can show: the product says "Unknown author" rather than leaving a blank. */
function authorName(author: CommentThread['author']): string {
  return author.displayName ?? 'Unknown author';
}

/**
 * The conversation: the comment that opened the thread, then its replies,
 * in the order they were made (comment-threads spec: "A reply joins the
 * existing thread … ordered by creation time"). One list, so the two are
 * drawn by one piece of markup and cannot drift apart.
 */
const messages = computed(() =>
  [
    { id: props.thread.id, author: props.thread.author, createdAt: props.thread.createdAt, body: props.thread.body, isReply: false },
    ...props.thread.replies.map((reply) => ({ id: reply.id, author: reply.author, createdAt: reply.createdAt, body: reply.body, isReply: true })),
  ].map((message) => ({
    ...message,
    name: authorName(message.author),
    // Computed here rather than in the template so the relative string and
    // its absolute title are read from one instant.
    relative: formatRelativeTime(message.createdAt),
    absolute: formatRevisionDate(message.createdAt),
  })),
);

const headingId = useId();
const replyLabelId = useId();
</script>

<template>
  <article
    :aria-labelledby="headingId"
    class="rounded-lg bg-default p-4"
    :data-comment-placement="placement"
    @focusin="emit('focusThread', thread.id)"
    @pointerenter="emit('focusThread', thread.id)"
  >
    <!-- The subject: what this thread is about, and — when the text is no
         longer where it was — a badge plus one sentence saying so. -->
    <header data-testid="comment-thread-header" class="mb-4">
      <p :id="headingId" class="sr-only">Comment thread on “{{ thread.anchor.quote }}”</p>

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

      <!-- The subject **is** the control that shows the text in the page.
           "Show in page" stood beside it as its own labelled button until
           2026-09-23 and no longer does: once focusing a thread highlights
           its span, a second control repeats what focus has already done,
           and it spent a tab stop and a line of the card saying "show in
           page" instead of pointing at anything. Putting the affordance on
           the quotation puts it on the thing it points at, which is the
           relation the owner said was missing — Word links the card to its
           anchor, Docs pairs the card with the highlighted span, and in
           both the quoted text is what you act on.

           The visible label is the quote; the accessible name is the quote
           with the verb around it, so the visible string is contained in
           the accessible one (WCAG 2.5.3) and a screen-reader user is told
           what activating it does. A tooltip carries the same words for a
           sighted user (§4.3). Hover, focus and press are the M3 state
           layer (§5.2), never a step to another surface rung. -->
      <UTooltip v-if="placement === 'anchored' && !pending" text="Show this text in the page">
        <blockquote class="border-s-2 border-default ps-3">
          <button
            data-testid="comment-locate"
            type="button"
            class="dw-state-layer w-full rounded-md px-1 py-0.5 text-start text-body-small text-muted"
            :aria-label="`Show “${thread.anchor.quote}” in the page`"
            @click="emit('locate', thread.anchor.blockId)"
          >
            “{{ thread.anchor.quote }}”
          </button>
        </blockquote>
      </UTooltip>
      <!-- Orphaned, unplaced, or still being posted: there is nothing in
           the page to show, and the sentence above says which of those it
           is rather than leaving a control to do nothing (§6, no inert
           interactions). -->
      <blockquote v-else class="border-s-2 border-default ps-3 text-body-small text-muted">“{{ thread.anchor.quote }}”</blockquote>

      <!-- The thread's own action, beside its subject: whether it is done.
           Never under the reply field, where it read as a second submit for
           the sentence being typed. -->
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <!-- Colour is never the only signal (§5): the word and the icon. -->
        <UBadge v-if="thread.resolved" data-testid="comment-resolved" variant="outline" color="success" icon="i-lucide-check" size="sm">
          Resolved
        </UBadge>
        <!-- The optimistic thread (§3, "Success — confirmed visibly"): on
             the page the moment Post is pressed, and marked as not yet the
             server's word — in text, not only by the missing controls. -->
        <UBadge v-else-if="pending" data-testid="comment-pending" role="status" variant="outline" color="neutral" icon="i-lucide-loader-circle" size="sm">
          Posting…
        </UBadge>

        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton
            v-if="canReply && !pending"
            data-testid="comment-resolve"
            size="sm"
            variant="ghost"
            color="neutral"
            :icon="thread.resolved ? 'i-lucide-rotate-ccw' : 'i-lucide-check'"
            :aria-disabled="busy || undefined"
            :title="busy ? 'Waiting for the last change to finish.' : undefined"
            @click="toggleResolved"
          >
            {{ thread.resolved ? 'Reopen' : 'Resolve' }}
          </UButton>
        </div>
      </div>
    </header>

    <!-- The conversation. One list; a reply is a message like the one that
         opened the thread, not a nested box beside it. -->
    <ol data-testid="comment-conversation" aria-label="Messages, oldest first" class="space-y-4">
      <li v-for="message in messages" :key="message.id" :data-testid="message.isReply ? 'comment-reply' : undefined">
        <div data-testid="comment-message" class="flex gap-3">
          <UAvatar data-testid="comment-avatar" :text="initials(message.name)" :alt="message.name" size="sm" class="mt-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-baseline gap-x-2">
              <span class="text-body-medium-emphasized text-highlighted">{{ message.name }}</span>
              <!-- §4.11 as amended 2026-09-23: the relative string is the
                   same in every zone; the absolute, zone-named instant is
                   the title, and the exact instant is the attribute. -->
              <time :datetime="message.createdAt" :title="message.absolute" class="text-body-small text-muted">{{ message.relative }}</time>
            </p>
            <p class="mt-1 text-body-medium text-default whitespace-pre-wrap">{{ message.body }}</p>
          </div>
        </div>
      </li>
    </ol>

    <!-- The reply affordance: one line, in the conversation's own message
         column, that grows when it is focused. A pending thread has no id
         to reply to yet; a caller who may not comment is offered nothing
         rather than something refused. -->
    <div
      v-if="canReply && !pending"
      data-testid="comment-reply-composer"
      class="mt-4"
      @focusin="composing = true"
      @focusout="onComposerFocusOut"
    >
      <UFormField :label="`Reply to ${messages[0]!.name}`" :ui="{ label: 'sr-only' }">
        <UTextarea
          v-model="draft"
          :rows="1"
          autoresize
          placeholder="Reply…"
          class="w-full"
          :aria-describedby="replyLabelId"
          :aria-disabled="busy || undefined"
          @keydown.ctrl.enter.prevent="submitReply"
        />
      </UFormField>
      <p :id="replyLabelId" class="sr-only">Ctrl+Enter posts your reply.</p>
      <div v-if="composing" class="mt-2 flex flex-wrap items-center gap-2">
        <UButton
          data-testid="comment-reply-submit"
          size="sm"
          icon="i-lucide-corner-down-left"
          :aria-disabled="!canReplyNow || undefined"
          :title="canReplyNow ? undefined : busy ? 'Waiting for the last change to finish.' : 'Write a reply first.'"
          @click="submitReply"
        >
          Reply
        </UButton>
      </div>
    </div>
  </article>
</template>

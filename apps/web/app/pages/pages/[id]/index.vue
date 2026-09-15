<script setup lang="ts">
/**
 * Read mode (document-modes spec: "Read Mode Serves Pre-Rendered HTML
 * Without Reparsing"; page-content spec: "Read mode request returns
 * cached HTML"). This route and everything it statically imports MUST
 * NOT reach `@deep-wiki/editor` or any ProseMirror/Milkdown module — that
 * is `scripts/checks/bundle-isolation.ts`'s build-output layer, verified
 * over a real production build (see `bun run check:bundle`).
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: any workspace member with `read` on this page, most of the time
 *   arriving from a link or the navigation tree.
 * - Goal, in their words: "Read this page."
 * - Single primary action: none — this is a reading surface. "Edit"
 *   in the header is the transition to the one screen that has a primary
 *   action, not this screen's own.
 * - Data needed: the cached HTML this page's last save produced. Nothing
 *   else exists to render before that response arrives.
 * - Non-goals: no editing, no parsing, no AI panel. Comments are read,
 *   replied to and resolved here (tasks.md 10.7); starting a new thread
 *   is not in this batch.
 * - Empty / overflow: a page with a 12,000-word document is exactly what
 *   the constrained measure and skeleton exist for; there is no
 *   "too much" state beyond normal scrolling.
 */
// Inside the workspace layout: the frame is mounted once and this screen
// renders only its pane, so the sidebar's tree keeps its scroll and its
// folds when the person arrives here from a row (`layouts/workspace.vue`).
definePageMeta({ layout: 'workspace' });

const route = useRoute();
const nodeId = route.params.id as string;

const { status, html, title, workspaceId, message, load } = usePageRead(nodeId);

/**
 * editing-presence spec / design.md Decision 5 ("Presence and SSE"): "who
 * is editing this page, and since when" (docs/UI-CHECKLIST.md §4.8),
 * surfaced through the same `usePresenceStream` composable edit.vue uses.
 *
 * The stream is `GET /workspaces/:workspaceId/presence/stream`,
 * workspace-scoped, and until 2026-09-14 this screen had nothing honest to
 * open it with: the read response carried no workspace id, and the only
 * other route that did — `GET /pages/:id/edit-session` — acquires the soft
 * lock as a side effect and must never be called from a read-only screen
 * just to read a field off it. `ReadPageResponseSchema` now names the
 * workspace, so the stream starts the moment the id is known and never
 * before (a stream request against a guessed workspace would be worse than
 * none).
 *
 * **Cost, since read mode is ~95% of this product's traffic
 * (docs/SPECS.md §5.3):** `usePresenceStream` pauses its connection
 * whenever `document.visibilityState` is `hidden` and resumes on
 * `visibilitychange`, rather than holding one workspace-wide SSE
 * connection (plus the server's own poll-tick over the `presence` view,
 * design.md "Multiple API processes") open per backgrounded read tab. That
 * is the one lever available client-side against the read screen's own
 * traffic share.
 */
const presence = usePresenceStream(nodeId);
// `immediate: true` for the same reason edit.vue gives: a response that is
// already resolved the first time this runs must start the stream exactly
// the way one that resolves a tick later does.
watch(
  workspaceId,
  (value) => {
    if (value) presence.start(value);
  },
  { immediate: true },
);
onBeforeUnmount(() => presence.stop());

/**
 * Whether the app bar may offer the page's other two surfaces at all.
 *
 * `forbidden` and `not-found` are the two states where every route that
 * takes this node id can only refuse: `/edit` denies, and `/history`
 * answers with the byte-identical not-found the API deliberately returns
 * for both absence and denial. Offering either is a dead end, not a
 * transition (docs/UI-CHECKLIST.md §3, "Disabled" — a control with no
 * honest enabled state is worse than absent). Loading and network-error
 * are transient and keep both: the page may well resolve into one that
 * has an editor and a history.
 *
 * One predicate, not one per control: the same rule written twice is two
 * chances to drift (checklist §4.1).
 */
const offersPageSurfaces = computed(() => status.value !== 'forbidden' && status.value !== 'not-found');

/**
 * The comment overlay (comment-overlay spec: "The Client Composes
 * Indicators Onto Unchanged Cached HTML"; tasks.md 10.7 and 10.9). Three
 * pieces, each owned elsewhere and only wired here:
 *
 * - `usePageComments` — one request, `GET /pages/:id/comments`, started
 *   in `onMounted` beside the page request, never after it. Its own note
 *   says why the threads and not the indicators endpoint, and what that
 *   costs on the read path: one small request per page view, a 14-byte
 *   `{"threads":[]}` for the ~95% of callers who only read (docs/SPECS.md
 *   §5.3), the thread bodies up front for the ones who can comment.
 * - `useBlockPlacement` — reads the `data-block-id` attributes back out
 *   of the rendered article and says where each mark goes and which
 *   threads have no block on screen to stand beside.
 * - `CommentGutter` and `CommentThreadPanel` — the marks and the panel.
 *
 * The article is `v-html` of the cached response and nothing here writes
 * into it: the highlight is a separate box drawn *behind* the article
 * (`-z-10` inside an `isolate` wrapper) at the block's measured top and
 * height, opaque `secondary-container` — the container fill §5.2 reserves
 * for exactly a selected/active state, legible under `text-default` in
 * both themes by construction (§10.1). It follows the panel: opening a
 * block's threads sets it, closing the panel clears it, so it is
 * dismissible and never persists (docs/UI-CHECKLIST.md §4.7).
 *
 * Two degraded states are surfaced above the article as chip-tier
 * notices (`InlineNotice`, the third of the three tiers — one line about
 * the thing directly below it, one action), because neither can have a
 * mark: an orphaned thread's block is gone (comment-threads spec, "Orphan
 * Is A First-Class State"), and a thread on a page whose cached render
 * predates `data-block-id` has a block the HTML does not name yet
 * (design.md Decision 6, "no anchors known" — the backfill, not an
 * error). Both chips open the panel on the full list, where the thread
 * renders with its excerpt and a sentence saying which of the two it is.
 */
const comments = usePageComments(nodeId);
const articleEl = ref<HTMLElement | null>(null);
const { placed, unplaced } = useBlockPlacement(articleEl, comments.indicators);

/**
 * The comments toggle — the owner: "the comments on the document should
 * also be toggleable". A display preference (`useCommentsVisibility`,
 * a cookie beside the sidebar's), for someone who can comment:
 *
 * - **It changes nothing about what is fetched.** `comments.load()` runs
 *   on every read, hidden or not, so the orphan chip and the count below
 *   stay honest; and a read-only caller — for whom the API answers
 *   `{ threads: [] }` — sees no marks and no toggle whichever way the
 *   preference points, because the toggle is offered only when there are
 *   threads to hide. A toggle that hides nothing is a control that does
 *   nothing (§6).
 * - **Hidden is not unaware.** While hidden, the toggle carries the
 *   number of open threads on this page that mention the caller
 *   (`usePageMentions`, off the workspace activity, asked for only in
 *   this state), in its name and as a badge — §3's honesty rule applied
 *   to a preference. The orphan chip stays regardless: a comment pointing
 *   at removed text is a state the author needs, not decoration. The
 *   "not placed yet" chip goes with the marks it is about.
 * - The change is announced (§5) in a live region that is always in the
 *   DOM and only changes text.
 */
const visibility = useCommentsVisibility();
const commentsHidden = visibility.hidden;
const hasThreads = computed(() => comments.threads.value.length > 0);
const mentions = usePageMentions(nodeId, workspaceId);
watch(
  [commentsHidden, workspaceId, hasThreads],
  ([hidden, workspace, threads]) => {
    if (hidden && workspace && threads) void mentions.load();
  },
  { immediate: true },
);
const visibilityAnnouncement = ref('');
const commentsToggleLabel = computed(() => {
  if (!commentsHidden.value) return 'Hide comments';
  const count = mentions.count.value;
  return count > 0 ? `Show comments — ${count} open thread${count === 1 ? '' : 's'} mention${count === 1 ? 's' : ''} you` : 'Show comments';
});

function toggleComments(): void {
  visibility.toggle();
  visibilityAnnouncement.value = commentsHidden.value ? 'Comments hidden.' : 'Comments shown.';
}

const panelOpen = ref(false);
const focusBlockId = ref<string | null>(null);
const busy = ref(false);
const announcement = ref('');

/** Anchored threads with no block on screen: the "no anchors known" count the chip states. */
const unplacedThreadCount = computed(
  () => comments.threads.value.filter((thread) => !thread.anchor.orphaned && unplaced.value.includes(thread.anchor.blockId)).length,
);

function openBlock(blockId: string): void {
  focusBlockId.value = blockId;
  panelOpen.value = true;
}

function openAll(): void {
  focusBlockId.value = null;
  panelOpen.value = true;
}

function onPanelOpen(open: boolean): void {
  panelOpen.value = open;
  if (!open) focusBlockId.value = null;
}

/** "Show in page" from the panel: scroll the block into view and highlight it (§4.7). */
function locate(blockId: string): void {
  focusBlockId.value = blockId;
  articleEl.value?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ block: 'center' });
}

/** The highlighted block's box, measured against the same wrapper the marks are placed in. */
const highlight = computed<{ top: number; height: number } | null>(() => {
  // `placed` is read so the box re-measures whenever the marks do.
  void placed.value;
  const blockId = focusBlockId.value;
  const root = articleEl.value;
  if (!blockId || !root) return null;
  const element = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
  return element ? { top: element.offsetTop, height: element.offsetHeight } : null;
});

async function onReply(threadId: string, body: string): Promise<void> {
  busy.value = true;
  announcement.value = '';
  const ok = await comments.reply(threadId, body);
  busy.value = false;
  if (ok) announcement.value = 'Reply posted.';
}

async function onResolve(threadId: string, resolved: boolean): Promise<void> {
  busy.value = true;
  announcement.value = '';
  const ok = await comments.setResolved(threadId, resolved);
  busy.value = false;
  if (ok) announcement.value = resolved ? 'Thread resolved.' : 'Thread reopened.';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

onMounted(() => {
  void load();
  void comments.load();
});

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: () => (title.value ? `${title.value} — deep-wiki` : 'deep-wiki') });
</script>

<template>
  <AppShell :workspace-id="workspaceId" :node-id="nodeId" :title="title || undefined">
    <!-- Inside the workspace frame: the sidebar's tree beside the article,
         the breadcrumb above it (shelf › book › chapter › page — placed
         through the tree once the response names the workspace, the title
         alone until then), and this screen's actions in the contextual bar.
         `workspaceId` is `null` until the page response names it; the frame
         stands on the last workspace the person was in meanwhile. -->
    <template #header-end>
      <!-- editing-presence spec: who is editing this page right now, and
           since when — informational only, never a lock of any kind on
           this screen (docs/UI-CHECKLIST.md §4.8). -->
      <PresenceIndicator :editors="presence.editors.value" class="mr-2" />
      <!-- The comments toggle (see the script's note): icon-only, so a name
           and a tooltip both (§4.3); the name carries the mention count
           while hidden, and the badge — `UChip`, M3's numbered badge
           (§9.7) — says it at a glance. Before the page's other views, and
           at the same size and emphasis as History beside it. -->
      <UChip v-if="hasThreads" :show="commentsHidden && mentions.count.value > 0" color="info" size="xl" inset>
        <template #content>
          <span data-testid="comments-mention-badge">{{ mentions.count.value }}</span>
        </template>
        <UTooltip :text="commentsToggleLabel">
          <UButton
            :icon="commentsHidden ? 'i-lucide-message-square-off' : 'i-lucide-message-square'"
            variant="ghost"
            color="neutral"
            size="sm"
            square
            :aria-label="commentsToggleLabel"
            :aria-pressed="!commentsHidden"
            @click="toggleComments"
          />
        </UTooltip>
      </UChip>
      <p data-testid="comments-visibility-status" role="status" aria-live="polite" class="sr-only">{{ visibilityAnnouncement }}</p>
      <!-- The way to this page's revision history. Until now `/pages/:id/
           history` was reachable only by typing the URL — a screen nobody
           can navigate to is not shipped, which is this repository's
           twice-repeated "route module nobody mounts" arriving one layer
           up (scripts/checks/routes-mounted.ts).

           It sits here, in the app bar, because that is where this page's
           *other* view already lives: read/edit is the transition the
           chrome carries, and history is the third view of the same node,
           not content about it. checklist §4.1 asks a new control to match
           the nearest existing one rather than invent a place, and the
           nearest one is 6px to the right. Read mode is ~95% of this
           product's traffic (docs/SPECS.md §5.3), so the chrome added here
           is paid on every page view — one 28px control, at the quietest
           emphasis the ladder has (`ghost` is M3's Text button,
           docs/DESIGN-SYSTEM.md §9.1), before the emphasised Edit, the
           same order edit mode already uses for "Read" then "Save".

           Icon-only, which checklist §4.3 allows only "where space
           genuinely forbids" a visible label — so it was measured, not
           assumed, and then re-measured with the control in place, which
           corrected the figure: at 320x900 the bar holds the brand
           (ending x=151), this control (172-200), "Edit" (206-270) and
           the theme toggle (276-304), with a 16px right margin. The slack
           is the single 21px gap between brand and history -- not the
           55px counted before this button existed, which it consumed 34px
           of. A labelled "History" needs ~70px against those 21, so the
           exception binds harder than the first measurement suggested;
           what is gone is any headroom for a fourth control at this width.
           §4.3's exception therefore binds, and it demands *both* halves —
           an accessible name and a tooltip — because the same glyph is
           ambiguous across icon packs. "Revision history", not "History":
           the name has to survive being read on its own, and it is the
           `<h1>` of the screen it lands on. -->
      <UTooltip v-if="offersPageSurfaces" text="Revision history">
        <UButton
          icon="i-lucide-history"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Revision history"
          :to="`/pages/${nodeId}/history`"
        />
      </UTooltip>

      <!-- Withheld on forbidden/not-found: offering an action the next
           screen can only refuse is a dead end, not a transition
           (docs/UI-CHECKLIST.md §3, "Disabled" — a control with no honest
           enabled state is worse than absent). Kept during loading and
           network-error: both are transient, and the page may well be
           editable once it resolves. -->
      <UButton
        v-if="offersPageSurfaces"
        icon="i-lucide-pencil"
        variant="soft"
        color="primary"
        size="sm"
        :to="`/pages/${nodeId}/edit`"
      >
        Edit
      </UButton>
    </template>

    <!-- The column is `AppShell`'s `measure`, its default: this screen is
         prose, and the reading measure is what prose takes
         (docs/DESIGN-SYSTEM.md §2.4, checklist §4.4's 65-80 characters) —
         now centred in a content pane that has a sidebar beside it, rather
         than in the middle of an empty viewport. It holds for *every*
         state, not for the success branch alone — before the column was
         one thing, the denied, missing and failed panels rendered 1216px
         wide while the document beside them rendered 659px, so the screen
         changed width with its state. -->

    <!-- Loading: a skeleton matched to the real layout, not a spinner —
         the document's shape is known in advance (docs/UI-CHECKLIST.md
         §3). It takes the loaded screen's own boxes rather than estimates
         of them: the title is `PageHeading`'s block — a 36px
         `headline-medium` line with the 32px `mb-8` under it — and the
         lines sit in real `doc-body` paragraphs, so each line box is the
         26px leading the prose gets and paragraphs are 16px apart, exactly
         as the rendered article lays them out. Before this the skeleton
         put a 16px line 24px under the title where the article puts a
         26px line 32px under the `h1` (audit, 2026-09-14).
         `e2e/read.spec.ts` holds the response back and measures both. -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="read-skeleton" aria-hidden="true">
      <div class="mb-8 max-w-measure">
        <USkeleton class="h-9 w-2/3" data-testid="read-skeleton-title" />
      </div>
      <!-- `as="span"`: a `<div>` inside a `<p>` is invalid HTML and the
           server-rendered skeleton would be re-parsed with the paragraph
           closed early, losing the 26px line box this exists for. -->
      <div class="doc-body text-doc-body">
        <p data-testid="read-skeleton-line"><USkeleton as="span" class="inline-block h-4 w-full align-middle" /></p>
        <p><USkeleton as="span" class="inline-block h-4 w-full align-middle" /></p>
        <p><USkeleton as="span" class="inline-block h-4 w-5/6 align-middle" /></p>
      </div>
    </div>

    <!-- Both notices carry the two doors `error.vue` gives — the workspaces
         list, where every signed-in subject's content starts, and sign-in,
         the quieter second door that never asserts which one the visitor
         needs (docs/UI-CHECKLIST.md §3, never a dead end; measured on
         2026-09-14 these were prose with no link). The not-found copy is
         `error.vue`'s reviewed paragraph, verbatim: one copy, and one that
         says out loud that it does not disclose. -->
    <PageNotice
      v-else-if="status === 'forbidden'"
      icon="i-lucide-lock"
      heading="You don't have access to this page"
    >
      Ask a workspace admin to grant you access, or go back to a page you can already read.
      <template #actions>
        <UButton icon="i-lucide-library-big" variant="solid" color="primary" to="/workspaces">Your workspaces</UButton>
        <UButton icon="i-lucide-log-in" variant="ghost" color="neutral" to="/login">Sign in</UButton>
      </template>
    </PageNotice>

    <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-file-question" heading="This page does not exist">
      It may have been moved or deleted, or it may be somewhere you don't have access to — deep-wiki deliberately doesn't say which, so that a page you can't see is indistinguishable from one that was never there.
      <template #actions>
        <UButton icon="i-lucide-library-big" variant="solid" color="primary" to="/workspaces">Your workspaces</UButton>
        <UButton icon="i-lucide-log-in" variant="ghost" color="neutral" to="/login">Sign in</UButton>
      </template>
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load this page"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton data-testid="read-retry" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">
          Retry
        </UButton>
      </template>
    </PageNotice>

    <!-- Success: the page's own `<h1>` (its title), then the cached
         HTML body as-is (already sanitised at render time, design.md
         D12) — the Markdown parser and the ProseMirror editor are never
         invoked for this request. -->
    <template v-else>
      <PageHeading :heading="title" />

      <!-- The overlay's degraded states, above the article they are about
           (see the script's own note). `role="status"` on the two the user
           navigated into; `alert` on the one that failed. -->
      <div
        v-if="comments.orphaned.value.length > 0 || (unplacedThreadCount > 0 && !commentsHidden) || comments.status.value === 'network-error'"
        class="mb-4 space-y-2"
      >
        <InlineNotice v-if="comments.orphaned.value.length > 0" data-testid="comments-orphaned" tier="chip" tone="warning">
          {{ plural(comments.orphaned.value.length, 'comment') }} point{{ comments.orphaned.value.length === 1 ? 's' : '' }} at text that is no longer on this page.
          <template #actions>
            <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-message-square" @click="openAll">Show</UButton>
          </template>
        </InlineNotice>
        <InlineNotice v-if="unplacedThreadCount > 0 && !commentsHidden" data-testid="comments-unplaced" tier="chip" tone="warning">
          {{ plural(unplacedThreadCount, 'comment') }} can't be shown beside {{ unplacedThreadCount === 1 ? 'its' : 'their' }} text until this page is re-rendered.
          <template #actions>
            <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-message-square" @click="openAll">Show</UButton>
          </template>
        </InlineNotice>
        <InlineNotice v-if="comments.status.value === 'network-error'" data-testid="comments-error" tier="chip" tone="error" role="alert">
          {{ comments.message.value }}
          <template #actions>
            <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" @click="comments.load">Retry</UButton>
          </template>
        </InlineNotice>
      </div>

      <!-- `relative isolate`: the marks are placed and the highlight is
           drawn against this box, and `isolate` keeps the highlight's
           `-z-10` behind the article rather than behind the page. The
           article gives up 40px of end padding for the marks only below
           `md` and only while a mark exists — from `md` up they stand in
           the margin outside the column (see `CommentGutter`). -->
      <div class="relative isolate">
        <div
          v-if="highlight"
          data-testid="comment-highlight"
          aria-hidden="true"
          class="absolute -inset-x-2 -z-10 rounded-md bg-secondary-container"
          :style="{ top: `${highlight.top}px`, height: `${highlight.height}px` }"
        />
        <!-- eslint-disable-next-line vue/no-v-html -- `html` is server-produced by remark-rehype + rehype-sanitize with an explicit allowlist (design.md D12); it is never client-supplied or user-editable at this route. -->
        <article ref="articleEl" class="doc-body text-doc-body text-default" :class="placed.length > 0 && !commentsHidden ? 'pe-10 md:pe-0' : undefined" v-html="html" />
        <CommentGutter v-if="!commentsHidden" :marks="placed" :active-block-id="panelOpen ? focusBlockId : null" @open="openBlock" />
      </div>

      <CommentThreadPanel
        :open="panelOpen"
        :threads="comments.threads.value"
        :focus-block-id="focusBlockId"
        :unplaced-block-ids="unplaced"
        :busy="busy"
        :write-message="comments.writeMessage.value"
        :announcement="announcement"
        @update:open="onPanelOpen"
        @show-all="focusBlockId = null"
        @reply="onReply"
        @resolve="onResolve"
        @locate="locate"
      />
    </template>
  </AppShell>
</template>

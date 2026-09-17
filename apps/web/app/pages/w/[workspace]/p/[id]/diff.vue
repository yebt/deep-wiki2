<script setup lang="ts">
/**
 * Page-level diff — added / removed / modified / **moved** between two
 * revisions (block-diff spec: "Diff Reports Added, Removed, Modified, And
 * Moved"; docs/UI-CHECKLIST.md §4.7: moved gets a visual treatment
 * distinct from the other three, never rendered as a delete plus an
 * insert). Reached from `history.vue`'s "Compare with previous" control —
 * task 10.1 built it inert; this task wires it.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a workspace member with `read` on this page, arriving from the
 *   history screen to see what changed between two specific revisions.
 * - Goal, in their words: "Show me what's different between these two
 *   saved versions."
 * - Single primary action: none — a reading surface, like the history
 *   screen it is reached from.
 * - Data needed: exactly what `GET /pages/:id/diff` returns — each
 *   change's kind, its slot(s), and its own block text (block-diff spec's
 *   `BlockChange` union carries no text on its own; the route attaches it
 *   from the same `sliceBlocks()` call that produced the classification,
 *   apps/api/src/routes/attach-block-text.ts). No page title: neither this
 *   endpoint nor the history one returns one, so none is invented here.
 * - Non-goals: no restore/rollback of a revision (out of this change), no
 *   line-level diff *between* blocks (block-diff spec forbids a text/line
 *   differ for classification — it is what would destroy "moved"). Inside
 *   one edited block the words that changed are marked (`segments` on a
 *   `modified` change, `diffInline()` in `packages/core`) — the owner's
 *   review of gate 10.4 on 2026-09-17 asked for "a diff like GitHub's".
 * - Empty / overflow: two revisions with no differences is a real,
 *   reachable state (every change classifies `unchanged`) — never folded
 *   into the error branch. A block containing a long unbroken token (a
 *   URL, a table) wraps or scrolls inside its own row rather than
 *   widening the page (docs/UI-CHECKLIST.md §6).
 *
 * The blocks themselves — the four classes, the word marks, the legend
 * and the "Unified | Side by side" control — are `DiffBlockChanges`, the
 * one component the book diff renders too (docs/UI-CHECKLIST.md §4.1).
 * This screen used to draw its own rows with a full-width
 * accent-container wash per changed row (the 2026-09-14 audit's
 * "highlighter pass over source"); the shared rows carry the signal on a
 * 4px accent border and an outlined badge instead, on the neutral inset.
 */
import { formatRevisionDate } from '~/utils/format-revision-date';
import { pageHistoryUrl, workspacesUrl } from '~/utils/routes';

// Inside the workspace layout: the frame is mounted once and this screen
// renders only its pane, so the sidebar's tree keeps its scroll and its
// folds when the person arrives here from history (`layouts/workspace.vue`).
definePageMeta({ layout: 'workspace' });

const route = useRoute();
const nodeId = route.params.id as string;
/** The workspace slug the address carries (`/w/<slug>/p/<id>/diff`): what every link this screen emits is built from. */
const workspaceSlug = route.params.workspace as string;
const historyUrl = pageHistoryUrl(workspaceSlug, nodeId);
const allWorkspacesUrl = workspacesUrl();
const fromId = (route.query.from as string | undefined) ?? '';
const toId = (route.query.to as string | undefined) ?? '';

const { status, diff, location, message, load } = usePageDiff(nodeId, fromId, toId);
// A signed-out visit leaves for sign-in and comes back (`useSignInRedirect`).
useSignInRedirect().redirectWhenSignedOut(status);

onMounted(() => {
  // A link with no `from`/`to` is a broken link, not a network condition —
  // rendered the same way an absent/denied page is, never by asking the
  // API to reject a malformed request.
  if (!fromId || !toId) {
    status.value = 'not-found';
    return;
  }
  void load();
});

/** Same constant, same reason as history.vue: a bare `'p-2'` leaves `UCard`'s `sm:p-6` standing, so the rows were inset 8px below 640px and 24px above (audit, 2026-09-14). 8px of card plus the row's 16px is 24px from the edge at every width. */
const CARD_BODY_INSET = 'p-2 sm:p-2';

/** The shared rows' own classes, repeated by the skeleton so its row is the loaded row's box by construction (docs/UI-CHECKLIST.md §3). */
const ROW_CLASS = 'rounded-md bg-default px-4 py-3 border-l-4 border-transparent';

const hasDifferences = computed(() => (diff.value?.changes ?? []).some((change) => change.kind !== 'unchanged'));

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: 'Page diff — deep-wiki' });
</script>

<template>
  <AppShell :workspace-id="null" :node-id="nodeId" :location="location" :trail="[{ label: 'History', to: historyUrl }, { label: 'Compare' }]">
    <template #header-end>
      <!-- The bar's one action. The pair being compared is NOT here:
           measured at 1280×900 with the 280px sidebar, two timestamps with
           their zones (about 370px) beside this control left the breadcrumb
           400px short and it truncated to "E2E Wor… › His… › Com…" — the
           identity the bar exists to show. The pair is the list's caption
           below instead, where the reading measure holds it on one line. -->
      <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" size="sm" :to="historyUrl">
        Back to history
      </UButton>
    </template>

    <!-- The screen's one `<h1>`, for the accessibility tree. Visibly, the
         identity is the breadcrumb's — "… › History › Compare" in the bar
         directly above — so a heading block repeating it would title the
         screen twice (the document-frame residue the owner reacted to on
         2026-09-15). The blocks start right under the bar; the notices
         below keep their `h2`. -->
    <h1 class="sr-only">Compare revisions</h1>

    <!-- Loading: the loaded screen's own boxes — the caption line, then
         the SAME card and the SAME row classes as the block list below,
         with the badge and the text swapped for bars of their heights —
         so a row is the same box by construction rather than by estimate
         (docs/UI-CHECKLIST.md §3). How many rows, and whether a "removed"
         card precedes them, only the response knows; `e2e/diff.spec.ts`
         holds it back and measures the caption and a row. -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="diff-skeleton" aria-hidden="true">
      <p class="mb-4 flex text-body-small">
        <USkeleton as="span" class="block h-4 w-80 max-w-full" data-testid="diff-skeleton-caption" />
      </p>
      <UCard variant="soft" :ui="{ body: CARD_BODY_INSET }">
        <div class="space-y-6">
          <!-- The legend line and the 32px layout control (`DiffBlockChanges`'s header row). -->
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p class="flex text-body-small"><USkeleton as="span" class="block h-4 w-72 max-w-full" /></p>
            <USkeleton class="h-8 w-48" />
          </div>
          <ol class="space-y-2">
            <li v-for="n in 3" :key="n" :class="ROW_CLASS" data-testid="diff-skeleton-row">
              <!-- The badge line (`UBadge size="sm"`: a 12px line on 4px of
                   padding each side, 20px) and one `body-medium` line of
                   block text (20px). -->
              <p class="mb-2 flex">
                <USkeleton as="span" class="block h-5 w-20" />
              </p>
              <p class="flex text-body-medium">
                <USkeleton as="span" class="block h-5 w-full" />
              </p>
            </li>
          </ol>
        </div>
      </UCard>
    </div>

    <!-- Absence and denial share this ONE state, the same non-disclosure
         precedent history.vue and read mode already follow. -->
    <!-- The copy is `error.vue`'s reviewed paragraph, verbatim, and the two
         doors are the ones it gives (§3, never a dead end). -->
    <PageNotice
      v-else-if="status === 'not-found'"
      icon="i-lucide-file-question"
      heading="This page does not exist"
      :level="2"
    >
      It may have been moved or deleted, or it may be somewhere you don't have access to — deep-wiki deliberately doesn't say which, so that a page you can't see is indistinguishable from one that was never there.
      <template #actions>
        <UButton icon="i-lucide-library-big" variant="solid" color="primary" :to="allWorkspacesUrl">Your workspaces</UButton>
        <UButton icon="i-lucide-log-in" variant="ghost" color="neutral" to="/login">Sign in</UButton>
      </template>
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load the diff"
      :level="2"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton data-testid="diff-retry" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">
          Retry
        </UButton>
      </template>
    </PageNotice>

    <!-- `v-else-if`, not `v-else`: a signed-out visit is a state this
         screen leaves rather than renders, and a bare `v-else` read the
         diff's `from` off a `null` on the way out. -->
    <template v-else-if="diff">
      <!-- The pair being compared: from, then to, each a `<time>` read in
           the viewer's own zone with the zone named and the instant kept in
           the attribute (docs/UI-CHECKLIST.md §4.11 — server-rendered in
           UTC, the viewer's zone once hydrated; `useViewerTimeZone`).
           `body-small text-muted`:
           §9.8's trailing meta, a caption over the list, not a heading. -->
      <p data-testid="diff-pair" class="mb-4 text-body-small text-muted">
        From <time :datetime="diff!.from.createdAt">{{ formatRevisionDate(diff!.from.createdAt) }}</time>
        to <time :datetime="diff!.to.createdAt">{{ formatRevisionDate(diff!.to.createdAt) }}</time>
      </p>

      <!-- Two revisions with no differences is a real state (block-diff
           spec), never folded into the error branch above. -->
      <PageNotice v-if="!hasDifferences" icon="i-lucide-equal" heading="No differences" :level="2">
        These two revisions have identical content.
      </PageNotice>

      <UCard v-else variant="soft" :ui="{ body: CARD_BODY_INSET }">
        <DiffBlockChanges
          :changes="diff!.changes"
          current-label="Current revision, annotated with what changed"
          removed-heading="Removed in this revision"
          removed-label="Blocks removed since the earlier revision"
        />
      </UCard>
    </template>
  </AppShell>
</template>

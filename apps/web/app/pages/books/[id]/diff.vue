<script setup lang="ts">
/**
 * Book diff — "what changed since <date>", navigable between changed pages
 * without returning to a list (block-diff spec: "Book-Level Diff
 * Aggregates Changed Pages Since A Date"; docs/UI-CHECKLIST.md §4.7's own
 * words for why this screen exists apart from the page-level one; task
 * 10.5). Reached from `history.vue`'s "View diff since here" / "Compare
 * since…" controls.
 *
 * Migrated onto the workspace frame: the breadcrumb now carries "…
 * › book › History › Changes since <date>" through the tree the sidebar
 * already holds, plus this screen's own trail — a real link back to book
 * history and the point compared from. The "Workspace home" and "Back to
 * history" buttons this screen used to carry in its own contextual bar
 * duplicated exactly those two doors (docs/UI-CHECKLIST.md §4.1) and are
 * gone. What replaced them is the page switcher itself — "previous /
 * current page name / next" — moved into the bar as this screen's own
 * control, so the pane below is the diff alone.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a workspace member with `read` on this book, arriving from book
 *   history to see everything that changed from a point in time forward,
 *   across every page it touched, without leaving this screen to open
 *   each page's own diff one at a time.
 * - Goal, in their words: "Show me everything that's changed in this book
 *   since <date>, and let me flip through the pages that changed."
 * - Single primary action: none — a reading surface. "Next"/"Previous"
 *   are this screen's own navigation, not an action on data.
 * - Data needed: `GET /books/:id/diff?since=` and nothing else. The
 *   response names the book (title, workspace) and, per changed page, its
 *   title, its baseline and latest revision ids and its text-bearing
 *   changes (76acabb). Until it did, this screen re-fetched every focused
 *   page's history and diff to get at the same facts — the N+1 the
 *   server-side query exists to avoid, done again from the browser
 *   (0ac1033 removed it; `useBookDiffNavigator.test.ts` holds a structural
 *   guard that it cannot come back).
 * - Non-goals: no revision restore, no editing from this screen.
 * - Empty / overflow: zero pages changed since the given date is real and
 *   reachable (a quiet window, or `since` set to "now"). A page created
 *   during the window has no earlier revision to diff against — the route
 *   says so with `baselineRevisionId: null`, and the screen renders it as
 *   a state of its own, never a crash or a silently skipped entry in the
 *   switcher.
 *
 * **Between-pages navigation, and the rule behind it**
 * (`useBookDiffNavigator`): the book diff is fetched exactly once.
 * "Next"/"Previous" only ever change which of the already-held pages is
 * focused — nothing is fetched per page and this screen never routes to a
 * list. `?page=` is kept in sync with the focused page (`router.replace`,
 * no history entry) so the current page survives a reload or a shared
 * link without turning "next" into a real navigation.
 *
 * **Switcher order.** `GET /books/:id/diff` orders changed pages by
 * `page_id` (`packages/db/src/changesets/book-diff.ts`), an id the
 * database mints at random — not tree position, so left as-is the
 * switcher's order would be arbitrary on every load (docs/TODO.md
 * Findings, 2026-09-14; the server should order instead — filed there).
 * `treeOrder`, below, reads the same tree the sidebar already holds
 * (`useWorkspaceTree`, keyed by the current workspace) and hands
 * `useBookDiffNavigator` a position for each changed page; when the tree
 * has not placed every one of them yet, the navigator falls back to title
 * order on its own (`useBookDiffNavigator.ts`'s own note).
 */
import { buildTreeOrderIndex } from '~/utils/tree-order';

definePageMeta({ layout: 'workspace' });

const route = useRoute();
const bookId = route.params.id as string;
const since = (route.query.since as string | undefined) ?? '';
const sinceIsValid = since.length > 0 && !Number.isNaN(new Date(since).getTime());

const current = useCurrentWorkspace();
const tree = useWorkspaceTree(current.workspaceId);
const treeOrder = computed(() => buildTreeOrderIndex(tree.nodes.value));

const nav = sinceIsValid
  ? useBookDiffNavigator(bookId, since, {
      initialPageId: route.query.page as string | undefined,
      pageOrder: (pageId) => treeOrder.value.get(pageId),
    })
  : null;

onMounted(() => {
  // A link with no (or an unparsable) `since` is a broken link, not a
  // network condition — rendered the same way page-diff.vue treats a
  // missing `from`/`to`, never by asking the API to reject a malformed
  // request (docs/UI-CHECKLIST.md §3, route-level failure).
  if (nav) void nav.load();
});

watch(
  () => nav?.currentPageId.value,
  (pageId) => {
    if (!pageId) return;
    void navigateTo({ query: { ...route.query, page: pageId } }, { replace: true });
  },
);

const sinceLabel = computed(() => (sinceIsValid ? formatRevisionDate(since) : ''));

const hasDifferences = computed(
  () => (nav?.currentPage.value?.diff.changes ?? []).some((change) => change.kind !== 'unchanged'),
);

/**
 * One `<h1>`, whose words change with the state and whose role does not
 * (docs/UI-CHECKLIST.md §4.4): the book's own name once the response
 * carries it, the screen's name until then — for the accessibility tree,
 * not the eye. The breadcrumb beside it in the contextual bar already
 * carries the book's name and the point compared from.
 */
const heading = computed(() => (nav?.title.value ? `${nav.title.value} — book diff` : 'Book diff'));

/**
 * "… › book › History › Changes since <date>" — "History" is a real link
 * back (the frame's tree only knows shelf/book/chapter/page, never this
 * screen, so the trail supplies it), the point compared from is not,
 * being this screen's own place.
 */
const trail = computed(() => [
  { label: 'History', to: `/books/${bookId}/history` },
  { label: sinceIsValid ? `Changes since ${sinceLabel.value}` : 'Book changes' },
]);

/** The switcher's own label: the focused page's title, with its position among the changed pages. */
function switcherLabel(pageTitle: string, index: number, total: number): string {
  return `${pageTitle} (${index + 1}/${total})`;
}

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: () => `${heading.value} — deep-wiki` });
</script>

<template>
  <AppShell :workspace-id="nav?.workspaceId.value ?? null" :node-id="bookId" :title="nav?.title.value || undefined" :trail="trail">
    <template #header-end>
      <!-- The page switcher: this screen's own control, in the contextual
           bar rather than the pane, so the pane below is the diff alone
           (docs/UI-CHECKLIST.md §4.7). "Previous / current page name /
           next" — the current page's name IS the link to open it, so the
           three elements the task names collapse into one control that
           does both jobs, rather than a name plus a separate "Open page"
           button crowding the bar further. -->
      <div v-if="nav && nav.pageIds.value.length > 0" class="flex min-w-0 items-center gap-1" role="group" aria-label="Changed pages">
        <UTooltip text="Previous changed page">
          <UButton
            icon="i-lucide-chevron-left"
            aria-label="Previous changed page"
            size="sm"
            variant="ghost"
            color="neutral"
            square
            :aria-disabled="!nav.hasPrev.value ? 'true' : undefined"
            @click="nav.hasPrev.value && nav.prev()"
          />
        </UTooltip>

        <UTooltip v-if="nav.currentPage.value" :text="`Open ${nav.currentPage.value.pageTitle}`">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            trailing-icon="i-lucide-external-link"
            class="min-w-0"
            :ui="{ label: 'min-w-0 truncate' }"
            :to="`/pages/${nav.currentPage.value.pageId}`"
          >
            {{ switcherLabel(nav.currentPage.value.pageTitle, nav.currentIndex.value, nav.pageIds.value.length) }}
          </UButton>
        </UTooltip>

        <UTooltip text="Next changed page">
          <UButton
            icon="i-lucide-chevron-right"
            aria-label="Next changed page"
            size="sm"
            variant="ghost"
            color="neutral"
            square
            :aria-disabled="!nav.hasNext.value ? 'true' : undefined"
            @click="nav.hasNext.value && nav.next()"
          />
        </UTooltip>
      </div>
    </template>

    <!-- The screen's one `<h1>` — see the script's own note. -->
    <h1 class="sr-only">{{ heading }}</h1>

    <!-- A malformed link is rendered like a not-found/denied screen, not
         asked of the API (see the script's own note). -->
    <PageNotice v-if="!sinceIsValid" icon="i-lucide-file-question" heading="This diff link is missing its date" :level="2">
      The link is missing the point in time to compare from, or the value it carries isn't a valid
      date. It may be an old or broken link.
    </PageNotice>

    <template v-else>
      <!-- Loading: a skeleton matched to the row shape it replaces
           (docs/UI-CHECKLIST.md §3). -->
      <div v-if="nav!.status.value === 'idle' || nav!.status.value === 'loading'" data-testid="book-diff-skeleton" class="space-y-3" aria-hidden="true">
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-24 w-5/6" />
      </div>

      <PageNotice v-else-if="nav!.status.value === 'not-found'" icon="i-lucide-file-question" heading="This book does not exist" :level="2">
        It may have been moved or deleted, or the link may be wrong.
      </PageNotice>

      <PageNotice
        v-else-if="nav!.status.value === 'network-error'"
        icon="i-lucide-circle-alert"
        heading="Couldn't load the book diff"
        :level="2"
        tone="error"
        role="alert"
      >
        {{ nav!.message.value }}
        <template #actions>
          <UButton data-testid="book-diff-retry" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="nav!.load">
            Retry
          </UButton>
        </template>
      </PageNotice>

      <!-- Genuinely empty and real: no page in this book changed after
           `since` — a quiet stretch, not an error. -->
      <PageNotice
        v-else-if="nav!.pageIds.value.length === 0"
        icon="i-lucide-equal"
        :heading="`No changes since ${sinceLabel}`"
        :level="2"
      >
        No page in this book was saved after that point in time.
      </PageNotice>

      <div v-else>
        <!-- Created during this window: nothing earlier to compare against
             (`baselineRevisionId` is `null`). A real state, with its own
             way forward. -->
        <PageNotice
          v-if="nav!.currentPage.value && nav!.currentPage.value.baselineRevisionId === null"
          icon="i-lucide-history"
          heading="This page was created during this window"
          :level="2"
        >
          There is no earlier revision to compare it against — created during this window, not
          edited from an earlier point.
          <template #actions>
            <UButton variant="outline" color="neutral" icon="i-lucide-history" :to="`/pages/${nav!.currentPage.value.pageId}/history`">
              View this page's full history
            </UButton>
          </template>
        </PageNotice>

        <PageNotice v-else-if="!hasDifferences" icon="i-lucide-equal" heading="No differences" :level="2">
          This page's content since {{ sinceLabel }} is identical.
        </PageNotice>

        <UCard v-else variant="soft" :ui="{ body: 'p-2 sm:p-2' }">
          <BookDiffBlockChanges :changes="nav!.currentPage.value?.diff.changes ?? []" />
        </UCard>
      </div>
    </template>
  </AppShell>
</template>

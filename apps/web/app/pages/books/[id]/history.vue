<script setup lang="ts">
/**
 * Book history — changesets as the unit (changesets spec: "Book-Level
 * History Is One Query"; design.md "New UI screens" row 3; task 10.5).
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a workspace member with `read` on this book, arriving to see who
 *   has been changing it, when, and which pages were touched together.
 * - Goal, in their words: "Show me what happened in this book over time,
 *   grouped the way it actually happened, not one line per save."
 * - Single primary action: none — a reading surface, like page history.
 *   Each changeset's "View diff since here" is a per-row navigation into
 *   task 10.5's other screen (`diff.vue`), not this screen's own action.
 * - Data needed: exactly what `GET /books/:id/history` returns — the
 *   book's own title and workspace, and per changeset its id, author
 *   id/name, optional message, `windowStart`/`windowEnd`, and the
 *   revisions (id, pageId, createdAt) it groups. The title names the
 *   screen and the workspace is where "back to the tree" goes; a page is
 *   still identified by a shortened id, because the response names pages
 *   by id only (a filed finding).
 * - Non-goals: no changeset message authoring (changesets spec: settable
 *   at save time, not from this read-only screen), no revision restore.
 * - Empty / overflow: a book that has never been saved into has zero
 *   changesets — real and reachable, since a book node (and pages under
 *   it) can exist and be readable before any of them are ever saved; its
 *   way forward is the tree the book lives in, where a page can be opened
 *   and edited. A book with many changesets, each grouping several pages,
 *   is the ordinary case this screen groups by design rather than
 *   flattening.
 */
import { formatRevisionDate } from '~/utils/format-revision-date';

const route = useRoute();
const bookId = route.params.id as string;

const { status, title, workspaceId, changesets, message, load } = useBookHistory(bookId);

/** One `<h1>`, whose words change with the state and whose role does not (docs/UI-CHECKLIST.md §4.4). */
const heading = computed(() => (title.value ? `${title.value} — book history` : 'Book history'));

onMounted(() => {
  void load();
});

/**
 * Every page touched by this changeset, deduplicated — `revisions` carries
 * one row per save, and one page can be saved more than once inside the
 * same changeset's window.
 */
function pagesIn(changeset: { revisions: readonly { pageId: string }[] }): string[] {
  return [...new Set(changeset.revisions.map((revision) => revision.pageId))];
}

/**
 * "View diff since here": everything from this changeset's own earliest
 * activity onward. The book-diff route filters `created_at > since`
 * (block-diff spec), so `since` is set to one millisecond BEFORE
 * `windowStart` — otherwise the changeset's own earliest revision, saved
 * exactly at `windowStart`, would be excluded by the strict inequality and
 * "diff since this changeset" would silently start one save late.
 */
function diffHref(changeset: { windowStart: string }): string {
  const sinceMs = new Date(changeset.windowStart).getTime() - 1;
  return `/books/${bookId}/diff?since=${encodeURIComponent(new Date(sinceMs).toISOString())}`;
}

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: () => `${heading.value} — deep-wiki` });
</script>

<template>
  <AppShell :workspace-id="workspaceId" :node-id="bookId" :trail="[{ label: 'Book history' }]">
    <template #header-end>
      <!-- The way back to the book's place in the tree, once the response
           has named the workspace. Icon-only with both halves §4.3
           demands — the same control the book-diff screen carries. -->
      <UTooltip v-if="workspaceId" text="Workspace home">
        <UButton
          icon="i-lucide-house"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Workspace home"
          :to="`/workspaces/${workspaceId}`"
        />
      </UTooltip>
    </template>

    <PageHeading :heading="heading" description="Every changeset in this book, newest first." />

    <!-- Loading: a skeleton matched to the row shape it replaces
         (docs/UI-CHECKLIST.md §3). Measured against the real row below at
         1280×900: author line 24px + 4px gap + meta line 20px + 4px gap +
         pages line 16px, inside 24px (py-3) of vertical padding — 92px.
         `h-24` (96px) is the nearest on-grid Tailwind step at or above
         that measured box, so the skeleton never undershoots the content
         it stands in for. -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="book-history-skeleton" class="space-y-3" aria-hidden="true">
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-24 w-5/6" />
    </div>

    <!-- Absence and denial share this ONE state, the same non-disclosure
         precedent page history and page diff already follow. -->
    <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-file-question" heading="This book does not exist" :level="2">
      It may have been moved or deleted, or the link may be wrong.
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load the book history"
      :level="2"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton data-testid="book-history-retry" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">
          Retry
        </UButton>
      </template>
    </PageNotice>

    <!-- Genuinely empty, and real: a book (and pages under it) can exist
         and be readable before anything in it has ever been saved,
         exactly as a single page can (page-history's own empty state).
         The way forward is the tree the book lives in — the response
         names the workspace now — where a page can be opened and edited
         (docs/UI-CHECKLIST.md §3: an empty state has a path forward). -->
    <PageNotice v-else-if="changesets.length === 0" icon="i-lucide-history" heading="No changes yet" :level="2">
      This book hasn't been saved into yet. Once a page inside it is saved, its changesets will
      appear here, grouped by author and time.
      <template v-if="workspaceId" #actions>
        <UButton variant="outline" color="neutral" icon="i-lucide-house" :to="`/workspaces/${workspaceId}`">
          Open the workspace
        </UButton>
      </template>
    </PageNotice>

    <UCard v-else variant="soft" :ui="{ body: 'p-2 sm:p-2' }">
      <ol aria-label="Book changeset history, newest first" class="divide-y divide-default">
        <li v-for="changeset in changesets" :key="changeset.id" class="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-body-large text-highlighted">
              <UIcon name="i-lucide-user-round" class="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span class="truncate">{{ changeset.authorDisplayName ?? 'Unknown author' }}</span>
            </p>
            <!-- Timestamp per docs/UI-CHECKLIST.md §4.11: viewer's own
                 zone, named, machine-readable `datetime`. `windowEnd` is
                 this changeset's own latest activity — the moment the
                 book-history query itself orders changesets by
                 (`listBookHistory`'s own doc comment). -->
            <p class="mt-1 text-body-medium text-muted">
              <time :datetime="changeset.windowEnd">{{ formatRevisionDate(changeset.windowEnd) }}</time>
              <span v-if="changeset.message"> · "{{ changeset.message }}"</span>
            </p>
            <p class="mt-1 text-body-small text-muted">
              {{ pagesIn(changeset).length }} page{{ pagesIn(changeset).length === 1 ? '' : 's' }} changed:
              <NuxtLink
                v-for="(pageId, index) in pagesIn(changeset)"
                :key="pageId"
                :to="`/pages/${pageId}`"
                class="text-primary underline-offset-2 hover:underline"
              >
                {{ pageId.slice(0, 8) }}<span v-if="index < pagesIn(changeset).length - 1">, </span>
              </NuxtLink>
            </p>
          </div>

          <UButton size="sm" variant="ghost" trailing-icon="i-lucide-arrow-right" :to="diffHref(changeset)">
            View diff since here
          </UButton>
        </li>
      </ol>
    </UCard>
  </AppShell>
</template>

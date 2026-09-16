<script setup lang="ts">
/**
 * Book history — changesets as the unit (changesets spec: "Book-Level
 * History Is One Query"; design.md "New UI screens" row 3; task 10.5).
 *
 * Migrated onto the workspace frame (docs/UI-CHECKLIST.md's 2026-09-15
 * entries): `layouts/workspace.vue` now mounts the sidebar once, and its
 * breadcrumb carries "workspace › shelf › book › History" through the tree
 * the sidebar already holds. Two things that existed only because that
 * breadcrumb did not are gone: the hand-built "Workspace home" door in the
 * contextual bar (the breadcrumb's own first crumb is already a link to
 * it) and the visible heading block naming the book (the breadcrumb's own
 * chain already does). What is left is a single `<h1>` for the
 * accessibility tree — sighted readers already have the name beside it in
 * the bar — and the changesets, which now fill the measure alone.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a workspace member with `read` on this book, arriving to see who
 *   has been changing it, when, and which pages were touched together.
 * - Goal, in their words: "Show me what happened in this book over time,
 *   grouped the way it actually happened, not one line per save."
 * - Single primary action: none — a reading surface, like page history.
 *   Each changeset's "View diff since here" is a per-row navigation into
 *   task 10.5's other screen (`diff.vue`), not this screen's own action;
 *   "Compare since…" in the contextual bar is the same transition, for the
 *   newest changeset, reachable without scrolling to the top row
 *   (docs/UI-CHECKLIST.md §4.1: match the nearest existing control rather
 *   than invent a place).
 * - Data needed: exactly what `GET /books/:id/history` returns — the
 *   book's own title and workspace, and per changeset its id, author
 *   id/name, optional message, `windowStart`/`windowEnd`, and the
 *   revisions (id, pageId, createdAt) it groups. A page is still
 *   identified by a shortened id: unlike `GET /books/:id/diff` (which
 *   gained page titles in 76acabb), this response names pages by id only
 *   — a filed finding, `docs/TODO.md`.
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

definePageMeta({ layout: 'workspace' });

const route = useRoute();
const bookId = route.params.id as string;

const { status, title, workspaceId, changesets, message, load } = useBookHistory(bookId);
// A signed-out visit leaves for sign-in and comes back (`useSignInRedirect`).
useSignInRedirect().redirectWhenSignedOut(status);

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
 * "View diff since here" / "Compare since…": everything from this
 * changeset's own earliest activity onward. The book-diff route filters
 * `created_at > since` (block-diff spec), so `since` is set to one
 * millisecond BEFORE `windowStart` — otherwise the changeset's own
 * earliest revision, saved exactly at `windowStart`, would be excluded by
 * the strict inequality and "diff since this changeset" would silently
 * start one save late.
 */
function diffHref(changeset: { windowStart: string }): string {
  const sinceMs = new Date(changeset.windowStart).getTime() - 1;
  return `/books/${bookId}/diff?since=${encodeURIComponent(new Date(sinceMs).toISOString())}`;
}

/**
 * "Compare since…" — the newest changeset's own transition, exposed in
 * the contextual bar so it is reachable without scrolling to the top row.
 * `null` (and the control withheld) when there is nothing to compare —
 * the same "no honest enabled state" rule that withholds Edit on a denied
 * read page (docs/UI-CHECKLIST.md §3, "Disabled").
 */
const compareHref = computed(() => (changesets.value.length > 0 ? diffHref(changesets.value[0]!) : null));

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: () => `${heading.value} — deep-wiki` });
</script>

<template>
  <AppShell :workspace-id="workspaceId" :node-id="bookId" :title="title || undefined" :trail="[{ label: 'History' }]">
    <!-- The history response names no workspace until it resolves; the
         frame stands on the last one the person was in meanwhile
         (`AppShell`'s own contract for `workspace-id`). -->
    <template #header-end>
      <UTooltip v-if="compareHref" text="Compare the most recent change with everything before it">
        <UButton icon="i-lucide-git-compare" variant="ghost" color="neutral" size="sm" :to="compareHref">
          Compare since…
        </UButton>
      </UTooltip>
    </template>

    <!-- `measure`, AppShell's default column: this screen is a single
         line of `body-large` per row read left to right, the same case
         the navigation tree already made for taking the reading measure
         rather than the `wide` column (docs/DESIGN-SYSTEM.md §2.4). -->

    <!-- The screen's one `<h1>` — for the accessibility tree, not the eye.
         The frame's breadcrumb already carries the book's name and
         "History" beside it in the contextual bar (docs/UI-CHECKLIST.md
         §4.1: the heading block that used to repeat that identity here is
         gone); this keeps exactly one heading, at one type role, across
         every state below (§4.4), the same way `PageNotice`'s own
         `level="2"` states already agree with it. -->
    <h1 class="sr-only">{{ heading }}</h1>

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

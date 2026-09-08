<script setup lang="ts">
/**
 * Page history — the revision list (revision-history spec: "Page History
 * Query Returns Revisions Newest First"; design.md "New UI screens", row
 * 1, a human-gate screen per `execution_mode.human_gates` — task 10.2
 * stops here for owner review before task 10.3's diff view is built).
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: any workspace member with `read` on this page, arriving to see
 *   who changed it, when, and to eventually compare two versions.
 * - Goal, in their words: "Show me every saved version of this page."
 * - Single primary action: none — a reading surface over metadata, like
 *   the navigation tree. Each row's "Compare with previous" is a
 *   per-revision navigation, not the screen's own primary action, and it
 *   is deliberately inert this batch (task 10.3 builds the diff view it
 *   would lead to; leaving it live would send a keyboard or pointer user
 *   into a route that does not exist yet).
 * - Data needed: exactly what `GET /pages/:id/history` returns — id,
 *   author id, author display name, `createdAt`, `changesetId`. No page
 *   title: that endpoint does not return one, so none is invented here;
 *   "Back to page" links out to the route that has it.
 * - Non-goals: no diff view (task 10.3), no book-level changeset history
 *   (task 10.5), no revision restore/rollback (out of this change).
 * - Empty / overflow: a page that has never been saved has zero
 *   revisions — a real, reachable state (a page node can exist and be
 *   readable before its first save), not a hypothetical. A page saved
 *   once has exactly one revision, which is the *oldest* row rendered
 *   ("Initial version") even though it is also the only one — nothing
 *   before it to compare against.
 */
import { formatRevisionDate } from '~/utils/format-revision-date';

const route = useRoute();
const nodeId = route.params.id as string;

const { status, revisions, message, load } = usePageHistory(nodeId);

onMounted(() => {
  void load();
});

/** Revisions arrive newest-first (revision-history spec); the last row is the oldest and has no earlier revision to compare against. */
function hasPrevious(index: number): boolean {
  return index < revisions.value.length - 1;
}

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: 'Revision history — deep-wiki' });
</script>

<template>
  <AppShell>
    <template #header-end>
      <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" size="sm" :to="`/pages/${nodeId}`">
        Back to page
      </UButton>
    </template>

    <!-- `measure`, AppShell's default column: this screen is a single
         line of `body-large` per row read left to right, the same case
         the navigation tree already made for taking the reading measure
         rather than the `wide` column (docs/DESIGN-SYSTEM.md §2.4). -->
    <PageHeading heading="Revision history" description="Every saved version of this page, newest first." />

    <!-- Loading: a skeleton matched to the row shape it replaces, not a
         spinner — the list's shape is known before the response arrives
         (docs/UI-CHECKLIST.md §3). -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="history-skeleton" class="space-y-3" aria-hidden="true">
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-16 w-5/6" />
    </div>

    <!-- Absence and denial share this ONE state (revision-history spec:
         "History denied without read"; the route returns a byte-identical
         404 for both). Splitting it back into a distinct permission-denied
         copy here would leak the difference the server deliberately does
         not. `level="2"`: PageHeading above already owns the page's `<h1>`. -->
    <PageNotice
      v-else-if="status === 'not-found'"
      icon="i-lucide-file-question"
      heading="This page does not exist"
      :level="2"
    >
      It may have been moved or deleted, or the link may be wrong.
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load the revision history"
      :level="2"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton data-testid="history-retry" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">
          Retry
        </UButton>
      </template>
    </PageNotice>

    <!-- Genuinely empty, with a path forward (docs/UI-CHECKLIST.md §3): a
         page node can exist and be readable before it has ever been
         saved, so this is reachable, not hypothetical — savePage() is the
         only code path that writes a page_revision row. -->
    <PageNotice
      v-else-if="revisions.length === 0"
      icon="i-lucide-history"
      heading="No revisions yet"
      :level="2"
    >
      This page hasn't been saved yet. Its first save creates the first revision.
      <template #actions>
        <UButton :to="`/pages/${nodeId}/edit`" variant="soft" color="primary" icon="i-lucide-pencil">
          Start editing
        </UButton>
      </template>
    </PageNotice>

    <!-- Success — including the one-revision case, which is a real state
         (revision-history spec) and not folded into the loading or empty
         branch above. A container on the app ground is the Filled card,
         never `bg-elevated` (docs/DESIGN-SYSTEM.md §9.4; the same
         precedent the navigation tree's own list follows). -->
    <UCard v-else variant="soft" :ui="{ body: 'p-2' }">
      <ol aria-label="Revision history, newest first" class="divide-y divide-default">
        <li
          v-for="(revision, index) in revisions"
          :key="revision.id"
          class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-body-large text-highlighted">
              <UIcon name="i-lucide-user-round" class="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span class="truncate">{{ revision.authorDisplayName ?? 'Unknown author' }}</span>
            </p>
            <p class="mt-1 text-body-medium text-muted">
              <time :datetime="revision.createdAt">{{ formatRevisionDate(revision.createdAt) }}</time>
              <span v-if="revision.changesetId"> · Part of a changeset</span>
            </p>
          </div>

          <!-- Inert: task 10.3 builds the diff view this would lead to.
               `aria-disabled`, not the `disabled` attribute, because it
               carries an explanation a keyboard user must be able to
               reach on focus, not only on hover (docs/UI-CHECKLIST.md §5). -->
          <UTooltip v-if="hasPrevious(index)" text="Page diff view isn't built yet">
            <UButton size="sm" variant="ghost" trailing-icon="i-lucide-arrow-right" aria-disabled="true" @click.prevent>
              Compare with previous
            </UButton>
          </UTooltip>
          <p v-else class="text-label-small text-muted">Initial version</p>
        </li>
      </ol>
    </UCard>
  </AppShell>
</template>

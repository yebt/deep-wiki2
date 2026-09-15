<script setup lang="ts">
/**
 * Page history — the revision list (revision-history spec: "Page History
 * Query Returns Revisions Newest First"; design.md "New UI screens", row
 * 1, a human-gate screen per `execution_mode.human_gates` — task 10.2
 * stopped here for owner review before task 10.3's diff view was built).
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: any workspace member with `read` on this page, arriving to see
 *   who changed it, when, and to compare two versions.
 * - Goal, in their words: "Show me every saved version of this page."
 * - Single primary action: none — a reading surface over metadata, like
 *   the navigation tree. Each row's "Compare with previous" is a
 *   per-revision navigation, not the screen's own primary action; it
 *   links to `diff.vue` (task 10.3) between this revision and the one
 *   right before it in this newest-first list.
 * - Data needed: exactly what `GET /pages/:id/history` returns — id,
 *   author id, author display name, `createdAt`, `changesetId`. No page
 *   title: that endpoint does not return one, so none is invented here;
 *   "Back to page" links out to the route that has it.
 * - Non-goals: no book-level changeset history (task 10.5), no revision
 *   restore/rollback (out of this change).
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

/** The revision "right before" the one at `index` — the next row down in this newest-first list, never the oldest one on a longer list. */
function previousRevisionId(index: number): string {
  return revisions.value[index + 1]!.id;
}

/**
 * The list card's body inset. `UCard`'s body is `p-4 sm:p-6`; a bare
 * `'p-2'` override replaces only the `p-4` half and leaves `sm:p-6`
 * standing, so the rows were inset 8px below 640px and 24px above it
 * (audit, 2026-09-14). Both breakpoints are set deliberately: 8px of card
 * inset plus the row's own 16px puts the text 24px from the card edge at
 * every width — the card's own medium-and-up inset (§7.4) — and the
 * skeleton reads the same constant so it cannot drift from the list.
 */
const CARD_BODY_INSET = 'p-2 sm:p-2';

function diffHref(index: number): string {
  const revision = revisions.value[index]!;
  return `/pages/${nodeId}/diff?from=${previousRevisionId(index)}&to=${revision.id}`;
}

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: 'Revision history — deep-wiki' });
</script>

<template>
  <AppShell :workspace-id="null" :node-id="nodeId" :trail="[{ label: 'History' }]">
    <!-- The history response names no workspace, so the frame stands on the
         last one the person was in (`AppShell`, `workspace-id="null"`). -->
    <template #header-end>
      <!-- The same control edit mode carries for the same destination:
           "Read page" with the eye, never a second chrome for `/pages/:id`
           (checklist §4.1). -->
      <UButton icon="i-lucide-eye" variant="ghost" color="neutral" size="sm" :to="`/pages/${nodeId}`">
        Read page
      </UButton>
    </template>

    <!-- `measure`, AppShell's default column: this screen is a single
         line of `body-large` per row read left to right, the same case
         the navigation tree already made for taking the reading measure
         rather than the `wide` column (docs/DESIGN-SYSTEM.md §2.4). -->
    <PageHeading heading="Revision history" description="Every saved version of this page, newest first." />

    <!-- Loading: a skeleton matched to the row shape it replaces, not a
         spinner — the list's shape is known before the response arrives
         (docs/UI-CHECKLIST.md §3). It is the SAME card and the SAME row
         classes as the loaded list below, with the two text lines swapped
         for skeleton bars of their line heights (24px `body-large`, 20px
         `body-medium`), so the box is identical by construction rather
         than by estimate: measured on 2026-09-14, three bare `h-16` bars
         stood outside the card at y=224 and 64px tall where the loaded
         rows sat at y=248 and 73px. `e2e/history.spec.ts` holds the
         response back and measures both. -->
    <UCard v-if="status === 'idle' || status === 'loading'" variant="soft" :ui="{ body: CARD_BODY_INSET }" data-testid="history-skeleton" aria-hidden="true">
      <ol class="divide-y divide-default">
        <li v-for="n in 3" :key="n" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <!-- `as="span"` inside the `<p>`s: a `<div>` in a paragraph is
               invalid HTML, and the server-rendered skeleton would be
               re-parsed with the paragraph closed early (measured: 93px
               rows instead of 73). -->
          <div class="min-w-0">
            <p class="flex items-center gap-2">
              <USkeleton as="span" class="block size-5 shrink-0 rounded-full" />
              <USkeleton as="span" class="block h-6 w-40" />
            </p>
            <p class="mt-1 flex">
              <USkeleton as="span" class="block h-5 w-64" />
            </p>
          </div>
          <USkeleton class="h-8 w-44" />
        </li>
      </ol>
    </UCard>

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
      It may have been moved or deleted, or it may be somewhere you don't have access to — deep-wiki deliberately doesn't say which, so that a page you can't see is indistinguishable from one that was never there.
      <template #actions>
        <UButton icon="i-lucide-library-big" variant="solid" color="primary" to="/workspaces">Your workspaces</UButton>
        <UButton icon="i-lucide-log-in" variant="ghost" color="neutral" to="/login">Sign in</UButton>
      </template>
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
    <UCard v-else variant="soft" :ui="{ body: CARD_BODY_INSET }">
      <ol aria-label="Revision history, newest first" class="divide-y divide-default">
        <li
          v-for="(revision, index) in revisions"
          :key="revision.id"
          class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-body-large text-highlighted">
              <!-- 20px: docs/DESIGN-SYSTEM.md §9.8's leading icon in a dense
                   list (the audit found this at `size-4`, 16px). -->
              <UIcon name="i-lucide-user-round" class="size-5 shrink-0 text-muted" aria-hidden="true" />
              <span class="truncate">{{ revision.authorDisplayName ?? 'Unknown author' }}</span>
            </p>
            <!-- The timestamp reads in the VIEWER's timezone (owner
                 decision, 2026-09-08), which is only safe because this
                 list is fetched in `onMounted` and so is never
                 server-rendered — see `formatRevisionDate`'s note.
                 Moving this fetch to `useAsyncData`/`useFetch` would
                 render these rows on the server, in the SERVER's zone,
                 and hydrate into a mismatch. `datetime` carries the
                 instant itself, so the exact moment survives the display
                 choice either way; `e2e/history.spec.ts` holds both
                 halves against two real browser timezones. -->
            <p class="mt-1 text-body-medium text-muted">
              <time :datetime="revision.createdAt">{{ formatRevisionDate(revision.createdAt) }}</time>
              <span v-if="revision.changesetId"> · Part of a changeset</span>
            </p>
          </div>

          <!-- Wired (task 10.3): links to the diff between this revision
               and the one right before it. A real `NuxtLink`, not a
               button with a click handler — `UButton`'s `to` prop keeps
               it in the normal navigation semantics a keyboard user and a
               screen reader both already expect from a link. -->
          <UButton
            v-if="hasPrevious(index)"
            size="sm"
            variant="ghost"
            trailing-icon="i-lucide-arrow-right"
            :to="diffHref(index)"
          >
            Compare with previous
          </UButton>
          <p v-else class="text-label-small text-muted">Initial version</p>
        </li>
      </ol>
    </UCard>
  </AppShell>
</template>

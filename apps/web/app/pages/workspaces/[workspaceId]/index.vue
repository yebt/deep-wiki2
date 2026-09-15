<script setup lang="ts">
/**
 * The workspace's home: what changed and who is here (apps/web/PRODUCT.md,
 * principle 2 — "opening the product answers 'what happened and who is
 * here' before anything else").
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: any member of this workspace, opening it at the start of a day or
 *   returning to it between pages — the person the sidebar's switcher and
 *   the workspace list both land here.
 * - Goal, in their words: "What did the team change since I last looked,
 *   who is working right now, and what is waiting on me?"
 * - Single primary action: none of its own — this is a reading surface;
 *   every row is a door to a page. Creating the first shelf is the
 *   sidebar's New…, which the empty state points at.
 * - Data: `GET /workspaces/:id/activity` (recent saves with block-diff
 *   class counts, the caller's own saves, open threads for the caller) and
 *   the presence stream (`usePresenceStream(null)` — every page in the
 *   workspace, the same stream read and edit mode open for one page).
 *   Nothing here is designed against data that does not exist.
 * - Non-goals: no search, no pinned pages, no per-shelf summaries, no
 *   settings — the workspace's doors are in the sidebar.
 * - Empty / overflow: a fresh workspace (no saves, nobody editing, no
 *   threads) says how to make the first page and where; a busy one is
 *   capped server-side at 20 changes, 10 own edits and 20 threads, so
 *   the columns stay columns.
 *
 * Layout: `AppShell`'s `wide` column, because this is the one screen whose
 * content is a grid of panels rather than a document (§2.4). Columns come
 * from the *content pane's* width, not the viewport's — `@container`, so
 * the same rule holds with the sidebar open, closed or resized: one column
 * narrow, two from `@2xl`, three from `@4xl`, where the changes list takes
 * two of the three (the width goes to the list that has the most to say).
 */
import type { ActivityChangeCounts } from '@deep-wiki/contracts';
import { formatRevisionDate } from '~/utils/format-revision-date';
import { initials } from '~/utils/initials';

// Inside the workspace layout: the frame — and the tree in it — is mounted
// once, and a click on a row swaps only this pane (`layouts/workspace.vue`).
definePageMeta({ layout: 'workspace' });

const route = useRoute();
const workspaceId = route.params.workspaceId as string;

const activity = useWorkspaceActivity(workspaceId);
const presence = usePresenceStream(null);

onMounted(() => {
  void activity.load();
  presence.start(workspaceId);
});
onBeforeUnmount(() => presence.stop());

/** The four class counts as chips, non-zero ones only, each in words as well as a colour (§5). */
const CLASSES: readonly { key: keyof ActivityChangeCounts; label: string; color: 'success' | 'error' | 'info' | 'secondary' }[] = [
  { key: 'added', label: 'added', color: 'success' },
  { key: 'modified', label: 'changed', color: 'info' },
  { key: 'moved', label: 'moved', color: 'secondary' },
  { key: 'removed', label: 'removed', color: 'error' },
];

function chipsOf(changes: ActivityChangeCounts) {
  return CLASSES.filter((entry) => changes[entry.key] > 0).map((entry) => ({ ...entry, count: changes[entry.key] }));
}

function plural(count: number, noun: string): string {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}

const isEmptyWorkspace = computed(
  () => activity.status.value === 'success' && activity.recent.value.length === 0 && activity.threads.value.length === 0 && presence.editors.value.length === 0,
);

useSeoMeta({ title: () => (activity.workspaceName.value ? `${activity.workspaceName.value} — deep-wiki` : 'deep-wiki') });
</script>

<template>
  <AppShell :workspace-id="workspaceId" column="wide">
    <!-- Loading: the grid's own shape — a title line, then panels with the
         rows they will hold — never a spinner in the middle of content
         (§3; operate.md). -->
    <div v-if="activity.status.value === 'idle' || activity.status.value === 'loading'" data-testid="dashboard-skeleton" aria-hidden="true">
      <USkeleton class="mb-6 h-9 w-64" />
      <div class="@container">
        <div class="grid gap-6 @2xl:grid-cols-2 @4xl:grid-cols-3">
          <USkeleton class="h-80 @4xl:col-span-2 @4xl:row-span-3" />
          <USkeleton class="h-40" />
          <USkeleton class="h-40" />
          <USkeleton class="h-40" />
        </div>
      </div>
    </div>

    <!-- Absence and denial share this one state, in the same words the
         tree uses: the route answers both with one 404. -->
    <PageNotice v-else-if="activity.status.value === 'not-found'" icon="i-lucide-file-question" heading="This workspace does not exist">
      It may have been renamed, or the link may be wrong — or it may be one you don't have access to; deep-wiki deliberately doesn't say which.
      <template #actions>
        <UButton icon="i-lucide-library-big" variant="solid" color="primary" to="/workspaces">Your workspaces</UButton>
      </template>
    </PageNotice>

    <PageNotice v-else-if="activity.status.value === 'network-error'" icon="i-lucide-circle-alert" heading="Couldn't load this workspace" tone="error" role="alert">
      {{ activity.message.value }}
      <template #actions>
        <UButton data-testid="dashboard-retry" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="activity.load">Retry</UButton>
      </template>
    </PageNotice>

    <template v-else>
      <!-- The screen's one `<h1>` is the room's name, `headline-medium`
           like every other screen's (§4.4). No eyebrow, no supporting
           sentence: the panels say what this is. -->
      <h1 class="mb-6 text-headline-medium text-highlighted">{{ activity.workspaceName.value }}</h1>

      <!-- A fresh workspace: one sentence that says what would be here and
           where to start, instead of four empty panels saying it four
           times (§3, empty states teach). -->
      <PageNotice v-if="isEmptyWorkspace" icon="i-lucide-library-big" heading="Nothing has happened here yet" :level="2" data-testid="dashboard-empty">
        Once someone saves a page, it shows up here with who changed it and what changed; people editing right now and the comment threads waiting on you appear beside it. Start with the sidebar: New… creates the first shelf, then a book, a chapter and a page inside it.
      </PageNotice>

      <div v-else class="@container">
        <!-- `items-start`: each panel is its content's height; a list is
             not stretched to fill a row it did not earn. -->
        <div class="grid items-start gap-6 @2xl:grid-cols-2 @4xl:grid-cols-3">
          <DashboardPanel title="Recent changes" :empty="activity.recent.value.length === 0" class="@4xl:col-span-2 @4xl:row-span-3">
            <template #empty>No page has been saved yet. Open a page and press Edit; every save lands here with who changed it and what changed.</template>
            <ol data-testid="dashboard-recent" class="divide-y divide-default">
              <li v-for="change in activity.recent.value" :key="change.revisionId" class="flex gap-3 px-4 py-3">
                <UAvatar :text="initials(change.author.displayName ?? '?')" :alt="change.author.displayName ?? 'Unknown author'" size="sm" class="mt-0.5 shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-body-medium text-default">
                    <span class="text-body-medium-emphasized text-highlighted">{{ change.author.displayName ?? 'Someone' }}</span>
                    edited
                    <ULink :to="`/pages/${change.pageId}`" class="text-primary underline-offset-4 hover:underline">{{ change.pageTitle }}</ULink>
                  </p>
                  <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-small text-muted">
                    <!-- Fetched client-side, never server-rendered, so the
                         viewer's own zone is the one named (§4.11). -->
                    <time :datetime="change.createdAt">{{ formatRevisionDate(change.createdAt) }}</time>
                    <template v-if="chipsOf(change.changes).length > 0">
                      <span aria-hidden="true">·</span>
                      <UBadge v-for="chip in chipsOf(change.changes)" :key="chip.key" :color="chip.color" variant="soft" size="xs">
                        {{ plural(chip.count, 'block') }} {{ chip.label }}
                      </UBadge>
                    </template>
                    <span v-else>
                      <span aria-hidden="true">·</span>
                      no block changes
                    </span>
                  </p>
                </div>
              </li>
            </ol>
          </DashboardPanel>

          <DashboardPanel title="Editing now" :empty="presence.editors.value.length === 0">
            <template #meta>
              <UBadge v-if="presence.editors.value.length > 0" color="primary" variant="soft" size="xs">{{ plural(presence.editors.value.length, 'person') }}</UBadge>
            </template>
            <template #empty>Nobody is editing right now. When someone opens a page to edit, they appear here with the page and since when.</template>
            <!-- Who and since when, never a lock (§4.8); the row is a status
                 region so a new editor is announced. -->
            <ul data-testid="dashboard-editing" role="status" aria-live="polite" class="divide-y divide-default">
              <li v-for="editor in presence.editors.value" :key="`${editor.pageId}:${editor.userId}`" class="flex gap-3 px-4 py-3">
                <UAvatar :text="initials(editor.userDisplayName)" :alt="editor.userDisplayName" size="sm" class="mt-0.5 shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-body-medium text-default">
                    <span class="text-body-medium-emphasized text-highlighted">{{ editor.userDisplayName }}</span>
                    is editing
                    <ULink :to="`/pages/${editor.pageId}`" class="text-primary underline-offset-4 hover:underline">{{ editor.pageTitle }}</ULink>
                  </p>
                  <p class="mt-1 text-body-small text-muted">since <time :datetime="editor.since">{{ formatRevisionDate(editor.since) }}</time></p>
                </div>
              </li>
            </ul>
          </DashboardPanel>

          <DashboardPanel title="Threads for you" :empty="activity.threads.value.length === 0">
            <template #meta>
              <UBadge v-if="activity.threads.value.some((t) => t.awaitsYou)" color="warning" variant="soft" size="xs">
                {{ plural(activity.threads.value.filter((t) => t.awaitsYou).length, 'reply') }} waiting
              </UBadge>
            </template>
            <template #empty>No open thread mentions you or waits on your reply. Threads you start, reply to, or are named in with @ show up here.</template>
            <ol data-testid="dashboard-threads" class="divide-y divide-default">
              <li v-for="thread in activity.threads.value" :key="thread.id" class="px-4 py-3">
                <p class="text-body-medium text-default">
                  <ULink :to="`/pages/${thread.pageId}`" class="text-primary underline-offset-4 hover:underline">{{ thread.pageTitle }}</ULink>
                  <span v-if="thread.orphaned" class="text-muted"> · text no longer on the page</span>
                </p>
                <!-- The excerpt the thread is about — one line, the thread's
                     own words, truncated with the full quote on hover. -->
                <p class="mt-1 truncate text-body-small text-muted" :title="thread.quote">“{{ thread.quote }}”</p>
                <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-small text-muted">
                  <span>{{ thread.author.displayName ?? 'Someone' }} · {{ plural(thread.replyCount, 'reply') }}</span>
                  <time :datetime="thread.lastActivityAt">{{ formatRevisionDate(thread.lastActivityAt) }}</time>
                  <UBadge v-if="thread.awaitsYou" color="warning" variant="soft" size="xs">Waiting on you</UBadge>
                  <UBadge v-if="thread.mentionsYou" color="info" variant="soft" size="xs">Names you</UBadge>
                </p>
              </li>
            </ol>
          </DashboardPanel>

          <DashboardPanel title="Your recent edits" :empty="activity.mine.value.length === 0">
            <template #empty>You haven't saved anything here yet. Open a page, press Edit, and your saves will be listed here for quick return.</template>
            <ol data-testid="dashboard-mine" class="divide-y divide-default">
              <li v-for="edit in activity.mine.value" :key="edit.revisionId" class="px-4 py-3">
                <p class="text-body-medium text-default">
                  <ULink :to="`/pages/${edit.pageId}`" class="text-primary underline-offset-4 hover:underline">{{ edit.pageTitle }}</ULink>
                </p>
                <p class="mt-1 text-body-small text-muted"><time :datetime="edit.createdAt">{{ formatRevisionDate(edit.createdAt) }}</time></p>
              </li>
            </ol>
          </DashboardPanel>
        </div>
      </div>
    </template>
  </AppShell>
</template>

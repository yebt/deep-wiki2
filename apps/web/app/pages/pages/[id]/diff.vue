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
 *   line-level diff inside a block (block-diff spec forbids a text/line
 *   differ outright — it is what would destroy "moved").
 * - Empty / overflow: two revisions with no differences is a real,
 *   reachable state (every change classifies `unchanged`) — never folded
 *   into the error branch. A block containing a long unbroken token (a
 *   URL, a table) wraps or scrolls inside its own row rather than
 *   widening the page (docs/UI-CHECKLIST.md §6).
 */
import { formatRevisionDate } from '~/utils/format-revision-date';

// Inside the workspace layout: the frame is mounted once and this screen
// renders only its pane, so the sidebar's tree keeps its scroll and its
// folds when the person arrives here from history (`layouts/workspace.vue`).
definePageMeta({ layout: 'workspace' });

const route = useRoute();
const nodeId = route.params.id as string;
const fromId = (route.query.from as string | undefined) ?? '';
const toId = (route.query.to as string | undefined) ?? '';

const { status, diff, message, load } = usePageDiff(nodeId, fromId, toId);

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

type Kind = 'added' | 'removed' | 'modified' | 'moved' | 'unchanged';

interface ChangeMeta {
  readonly label: string;
  readonly icon: string;
  readonly color: 'success' | 'error' | 'warning' | 'secondary';
}

// Moved is deliberately NOT a shade of added/removed/modified: `secondary`
// sits on a different hue entirely from the green/amber/red spectrum the
// other three share, so the distinction survives even for a viewer who
// cannot use hue at all (the icon and label carry it too — checklist §5,
// "colour is never the sole carrier of meaning").
//
// `moved`'s own icon/label are placeholders here — `badgeIcon`/`badgeLabel`
// below always replace them with a directional one (`↓`/`↑`, "Moved
// down"/"Moved up"). A generic crosshair icon and a bare "Moved" label are
// legible only by reading the badge; a review of the first cut of this
// screen found exactly that: the moved block appeared only in its NEW
// position with nothing communicating that it came from somewhere else.
// The direction is free — `moved`/`modified.moved` always carry distinct
// `fromSlot`/`toSlot` by construction (block-diff spec) — so an arrow that
// actually points the right way costs nothing extra to compute.
const KIND_META: Record<Exclude<Kind, 'unchanged'>, ChangeMeta> = {
  added: { label: 'Added', icon: 'i-lucide-plus', color: 'success' },
  removed: { label: 'Removed', icon: 'i-lucide-minus', color: 'error' },
  modified: { label: 'Modified', icon: 'i-lucide-pencil', color: 'warning' },
  moved: { label: 'Moved', icon: 'i-lucide-move', color: 'secondary' },
};

/** "down" when the block's new position is later in the document than its old one, "up" otherwise. `fromSlot`/`toSlot` are always distinct for `moved` and for `modified` with `moved: true` (block-diff spec). */
function movedDirection(fromSlot: number, toSlot: number): 'up' | 'down' {
  return toSlot > fromSlot ? 'down' : 'up';
}

/**
 * The 2026-09-14 audit read this screen as "a highlighter pass over
 * source, not a document" and laid out three directions: (a) render each
 * block as `doc-body` prose with a left rule and a badge; (b) keep the
 * slabs, fix the invisible badge, and show the before-text under a
 * modified block; (c) a "moved from here" ghost at the old position.
 * (b) is taken here as the cheapest honest improvement: the badge is a
 * `UBadge variant="soft"` on a row painted the very same container token,
 * and measured **1.00:1** — fixed at the system level (`app.config.ts`,
 * `TONAL_BOUNDARY`: every tonal chip and button carries an `outline`-role
 * ring), so the badge now reads as a chip on any ground. The before-text
 * half of (b) needs `apps/api/src/routes/attach-block-text.ts`, the diff
 * response contract and `usePageDiff.ts` to carry a `before` text for
 * `modified`, which this pass does not own; it is recorded as a follow-up.
 * (a) and (c) remain the owner's call.
 */
const ROW_CLASS: Record<Exclude<Kind, 'unchanged'>, string> = {
  added: 'bg-success-container',
  removed: 'bg-error-container',
  modified: 'bg-warning-container',
  moved: 'bg-secondary-container',
};

const TEXT_CLASS: Record<Kind, string> = {
  added: 'text-on-success-container',
  removed: 'text-on-error-container',
  modified: 'text-on-warning-container',
  moved: 'text-on-secondary-container',
  unchanged: 'text-default',
};

function rowClass(change: BlockChangeWithText): string {
  return change.kind === 'unchanged' ? '' : ROW_CLASS[change.kind];
}

function textClass(change: BlockChangeWithText): string {
  return TEXT_CLASS[change.kind];
}

function badgeLabel(change: BlockChangeWithText): string {
  if (change.kind === 'unchanged') return '';
  if (change.kind === 'moved') {
    return movedDirection(change.fromSlot, change.toSlot) === 'down' ? 'Moved down' : 'Moved up';
  }
  if (change.kind === 'modified' && change.moved) {
    return movedDirection(change.fromSlot, change.toSlot) === 'down' ? 'Modified · moved down' : 'Modified · moved up';
  }
  return KIND_META[change.kind].label;
}

function badgeIcon(change: BlockChangeWithText): string {
  if (change.kind === 'unchanged') return '';
  if (change.kind === 'moved' || (change.kind === 'modified' && change.moved)) {
    return movedDirection(change.fromSlot, change.toSlot) === 'down' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up';
  }
  return KIND_META[change.kind].icon;
}

function badgeColor(change: BlockChangeWithText): ChangeMeta['color'] | undefined {
  return change.kind === 'unchanged' ? undefined : KIND_META[change.kind].color;
}

/** The after-document's own order: `slot` for added/unchanged, `toSlot` for anything that landed on the after side by moving or changing. */
function afterPosition(change: BlockChangeWithText): number {
  return change.kind === 'modified' || change.kind === 'moved' ? change.toSlot : change.slot;
}

const removedChanges = computed(() =>
  (diff.value?.changes ?? [])
    .filter((change): change is Extract<BlockChangeWithText, { kind: 'removed' }> => change.kind === 'removed')
    .toSorted((a, b) => a.slot - b.slot),
);

const currentChanges = computed(() =>
  (diff.value?.changes ?? []).filter((change) => change.kind !== 'removed').toSorted((a, b) => afterPosition(a) - afterPosition(b)),
);

/** Same constant, same reason as history.vue: a bare `'p-2'` leaves `UCard`'s `sm:p-6` standing, so the rows were inset 8px below 640px and 24px above (audit, 2026-09-14). 8px of card plus the row's 16px is 24px from the edge at every width. */
const CARD_BODY_INSET = 'p-2 sm:p-2';

const hasDifferences = computed(() => (diff.value?.changes ?? []).some((change) => change.kind !== 'unchanged'));

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: 'Page diff — deep-wiki' });
</script>

<template>
  <AppShell :workspace-id="null" :node-id="nodeId" :trail="[{ label: 'History', to: `/pages/${nodeId}/history` }, { label: 'Compare' }]">
    <template #header-end>
      <!-- The bar's one action. The pair being compared is NOT here:
           measured at 1280×900 with the 280px sidebar, two timestamps with
           their zones (about 370px) beside this control left the breadcrumb
           400px short and it truncated to "E2E Wor… › His… › Com…" — the
           identity the bar exists to show. The pair is the list's caption
           below instead, where the reading measure holds it on one line. -->
      <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" size="sm" :to="`/pages/${nodeId}/history`">
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
        <ol class="divide-y divide-default">
          <li v-for="n in 3" :key="n" class="rounded-md px-4 py-3" data-testid="diff-skeleton-row">
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
        <UButton icon="i-lucide-library-big" variant="solid" color="primary" to="/workspaces">Your workspaces</UButton>
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

    <template v-else>
      <!-- The pair being compared: from, then to, each a `<time>` read in
           the viewer's own zone with the zone named and the instant kept in
           the attribute (docs/UI-CHECKLIST.md §4.11 — fetched in
           `onMounted`, so never server-rendered). `body-small text-muted`:
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

      <div v-else class="space-y-6">
        <UCard v-if="removedChanges.length > 0" variant="soft" :ui="{ body: CARD_BODY_INSET }">
          <p class="px-4 pt-3 text-label-large text-muted">Removed in this revision</p>
          <ol aria-label="Blocks removed since the earlier revision" class="divide-y divide-default">
            <li
              v-for="change in removedChanges"
              :key="`removed-${change.id}`"
              class="rounded-md px-4 py-3"
              :class="rowClass(change)"
            >
              <!-- In its own flex line, so the row's first line box is the
                   badge's own height rather than the inherited strut's —
                   what lets the skeleton draw the same box by construction. -->
              <p class="mb-2 flex">
                <UBadge :color="badgeColor(change)" variant="soft" :icon="badgeIcon(change)" size="sm">
                  {{ badgeLabel(change) }}
                </UBadge>
              </p>
              <pre class="overflow-x-auto font-mono text-body-medium whitespace-pre-wrap break-words" :class="textClass(change)">{{ change.text }}</pre>
            </li>
          </ol>
        </UCard>

        <UCard variant="soft" :ui="{ body: CARD_BODY_INSET }">
          <ol aria-label="Current revision, annotated with what changed" class="divide-y divide-default">
            <li
              v-for="change in currentChanges"
              :key="`current-${change.id}`"
              class="rounded-md px-4 py-3"
              :class="rowClass(change)"
            >
              <p v-if="change.kind !== 'unchanged'" class="mb-2 flex">
                <UBadge :color="badgeColor(change)" variant="soft" :icon="badgeIcon(change)" size="sm">
                  {{ badgeLabel(change) }}
                </UBadge>
              </p>
              <pre class="overflow-x-auto font-mono text-body-medium whitespace-pre-wrap break-words" :class="textClass(change)">{{ change.text }}</pre>
            </li>
          </ol>
        </UCard>
      </div>
    </template>
  </AppShell>
</template>

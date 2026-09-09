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
const KIND_META: Record<Exclude<Kind, 'unchanged'>, ChangeMeta> = {
  added: { label: 'Added', icon: 'i-lucide-plus', color: 'success' },
  removed: { label: 'Removed', icon: 'i-lucide-minus', color: 'error' },
  modified: { label: 'Modified', icon: 'i-lucide-pencil', color: 'warning' },
  moved: { label: 'Moved', icon: 'i-lucide-move', color: 'secondary' },
};

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
  if (change.kind === 'modified' && change.moved) return 'Modified · moved';
  return KIND_META[change.kind].label;
}

function badgeIcon(change: BlockChangeWithText): string {
  return change.kind === 'unchanged' ? '' : KIND_META[change.kind].icon;
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

const hasDifferences = computed(() => (diff.value?.changes ?? []).some((change) => change.kind !== 'unchanged'));

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: 'Page diff — deep-wiki' });
</script>

<template>
  <AppShell>
    <template #header-end>
      <UButton icon="i-lucide-arrow-left" variant="ghost" color="neutral" size="sm" :to="`/pages/${nodeId}/history`">
        Back to history
      </UButton>
    </template>

    <PageHeading heading="Page diff" description="What changed between two saved revisions." />

    <div v-if="status === 'idle' || status === 'loading'" data-testid="diff-skeleton" class="space-y-3" aria-hidden="true">
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-24 w-5/6" />
    </div>

    <!-- Absence and denial share this ONE state, the same non-disclosure
         precedent history.vue and read mode already follow. -->
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

    <!-- Two revisions with no differences is a real state (block-diff
         spec), never folded into the error branch above. -->
    <PageNotice
      v-else-if="!hasDifferences"
      icon="i-lucide-equal"
      heading="No differences"
      :level="2"
    >
      These two revisions have identical content.
    </PageNotice>

    <div v-else class="space-y-6">
      <UCard v-if="removedChanges.length > 0" variant="soft" :ui="{ body: 'p-2' }">
        <p class="px-4 pt-3 text-label-large text-muted">Removed in this revision</p>
        <ol aria-label="Blocks removed since the earlier revision" class="divide-y divide-default">
          <li
            v-for="change in removedChanges"
            :key="`removed-${change.id}`"
            class="rounded-md px-4 py-3"
            :class="rowClass(change)"
          >
            <UBadge :color="badgeColor(change)" variant="soft" :icon="badgeIcon(change)" size="sm" class="mb-2">
              {{ badgeLabel(change) }}
            </UBadge>
            <pre class="overflow-x-auto font-mono text-body-medium whitespace-pre-wrap break-words" :class="textClass(change)">{{ change.text }}</pre>
          </li>
        </ol>
      </UCard>

      <UCard variant="soft" :ui="{ body: 'p-2' }">
        <ol aria-label="Current revision, annotated with what changed" class="divide-y divide-default">
          <li
            v-for="change in currentChanges"
            :key="`current-${change.id}`"
            class="rounded-md px-4 py-3"
            :class="rowClass(change)"
          >
            <UBadge
              v-if="change.kind !== 'unchanged'"
              :color="badgeColor(change)"
              variant="soft"
              :icon="badgeIcon(change)"
              size="sm"
              class="mb-2"
            >
              {{ badgeLabel(change) }}
            </UBadge>
            <pre class="overflow-x-auto font-mono text-body-medium whitespace-pre-wrap break-words" :class="textClass(change)">{{ change.text }}</pre>
          </li>
        </ol>
      </UCard>
    </div>
  </AppShell>
</template>

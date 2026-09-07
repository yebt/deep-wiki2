<script setup lang="ts">
/**
 * The navigation tree (navigation-tree spec: only readable nodes,
 * drag-reorder writes back to `position`). A human-gate screen per
 * `execution_mode.human_gates`.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: any workspace member, most often navigating from the header
 *   brand link while reading or editing a page.
 * - Goal, in their words: "Find a page, or reorganise how they're shelved."
 * - Single primary action: none — a navigation surface, not a form. Drag
 *   reorder is an in-place manipulation of the tree itself, not a
 *   separate submit step.
 * - Data needed: the can()-filtered tree this route already returns —
 *   nothing here is designed against data that does not exist yet.
 * - Non-goals: no create/rename/delete affordances (a separate, later
 *   surface); no multi-select.
 * - Empty / overflow: a workspace with nothing yet, and a shelf with
 *   hundreds of pages, are both handled below (empty state; the tree
 *   renders unvirtualized in this batch, a recorded scope limit for a
 *   400-page book).
 */
const route = useRoute();
const workspaceId = route.params.workspaceId as string;

const { status, nodes, rootId, message, load, reorder } = useTree(workspaceId);

onMounted(() => {
  void load();
});

const reorderError = ref<string | null>(null);

async function onReorder(payload: { draggedId: string; newParentId: string; newIndex: number }): Promise<void> {
  reorderError.value = null;
  const ok = await reorder(payload.draggedId, payload.newParentId, payload.newIndex);
  if (!ok) {
    reorderError.value = "That move isn't allowed — you may only have read access to this item, or the target is in a different workspace.";
  }
}

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: 'Navigation tree — deep-wiki' });
</script>

<template>
  <AppShell>
    <UContainer class="py-10 sm:py-16">
      <PageHeading heading="Navigation tree" description="Every shelf, book, chapter and page you can read." />

      <div v-if="status === 'idle' || status === 'loading'" data-testid="tree-skeleton" class="max-w-measure space-y-2" aria-hidden="true">
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-5/6 ms-4" />
        <USkeleton class="h-10 w-4/6 ms-8" />
        <USkeleton class="h-10 w-5/6 ms-4" />
      </div>

      <div v-else-if="status === 'forbidden'" role="status" class="flex items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-lock" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <h2 class="text-headline-small text-highlighted">You don't have access to this workspace</h2>
          <p class="text-body-medium text-muted mt-2">Ask a workspace admin to grant you access.</p>
        </div>
      </div>

      <div v-else-if="status === 'not-found'" role="status" class="flex items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-file-question" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <h2 class="text-headline-small text-highlighted">This workspace does not exist</h2>
        </div>
      </div>

      <div v-else-if="status === 'network-error'" role="alert" class="flex items-start gap-3 rounded-lg bg-error-container p-6">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
        <div>
          <h2 class="text-headline-small text-on-error-container">Couldn't load the tree</h2>
          <p class="text-body-medium text-on-error-container mt-2">{{ message }}</p>
          <UButton class="mt-4" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
        </div>
      </div>

      <!-- First-run empty state, distinct from "nothing readable" — this
           batch has no filter/search on this screen, so there is no
           filtered-empty variant to distinguish it from. -->
      <div v-else-if="nodes.length === 0" class="flex flex-col items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-library-big" class="size-8 text-muted" aria-hidden="true" />
        <div>
          <h2 class="text-headline-small text-highlighted">No shelves yet</h2>
          <p class="text-body-medium text-muted mt-2">Create a shelf to start organising books, chapters and pages.</p>
        </div>
      </div>

      <div v-else class="max-w-measure">
        <p v-if="reorderError" role="alert" class="mb-4 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container">
          {{ reorderError }}
        </p>
        <ul role="tree" aria-label="Navigation tree" class="rounded-lg bg-elevated p-2">
          <NavigationTreeNode
            v-for="(node, index) in nodes"
            :key="node.id"
            :node="node"
            :depth="0"
            :parent-id="rootId ?? ''"
            :index="index"
            @reorder="onReorder"
          />
        </ul>
      </div>
    </UContainer>
  </AppShell>
</template>

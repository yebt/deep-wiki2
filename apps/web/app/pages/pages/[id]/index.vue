<script setup lang="ts">
/**
 * Read mode (document-modes spec: "Read Mode Serves Pre-Rendered HTML
 * Without Reparsing"; page-content spec: "Read mode request returns
 * cached HTML"). This route and everything it statically imports MUST
 * NOT reach `@deep-wiki/editor` or any ProseMirror/Milkdown module — that
 * is `scripts/checks/bundle-isolation.ts`'s build-output layer, verified
 * over a real production build (see `bun run check:bundle`).
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: any workspace member with `read` on this page, most of the time
 *   arriving from a link or the navigation tree.
 * - Goal, in their words: "Read this page."
 * - Single primary action: none — this is a reading surface. "Edit"
 *   in the header is the transition to the one screen that has a primary
 *   action, not this screen's own.
 * - Data needed: the cached HTML this page's last save produced. Nothing
 *   else exists to render before that response arrives.
 * - Non-goals: no editing, no parsing, no comments/AI panel (out of this
 *   batch's scope — see the UI review brief).
 * - Empty / overflow: a page with a 12,000-word document is exactly what
 *   the constrained measure and skeleton exist for; there is no
 *   "too much" state beyond normal scrolling.
 */
const route = useRoute();
const nodeId = route.params.id as string;

const { status, html, title, message, load } = usePageRead(nodeId);

onMounted(() => {
  void load();
});

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: () => (title.value ? `${title.value} — deep-wiki` : 'deep-wiki') });
</script>

<template>
  <AppShell>
    <template #header-end>
      <!-- Withheld on forbidden/not-found: offering an action the next
           screen can only refuse is a dead end, not a transition
           (docs/UI-CHECKLIST.md §3, "Disabled" — a control with no honest
           enabled state is worse than absent). Kept during loading and
           network-error: both are transient, and the page may well be
           editable once it resolves. -->
      <UButton
        v-if="status !== 'forbidden' && status !== 'not-found'"
        icon="i-lucide-pencil"
        variant="soft"
        color="primary"
        size="sm"
        :to="`/pages/${nodeId}/edit`"
      >
        Edit
      </UButton>
    </template>

    <UContainer class="py-10 sm:py-16">
      <!-- Loading: a skeleton matched to the real layout (a title line
           plus paragraph-shaped lines), not a spinner — the document's
           shape is known in advance (docs/UI-CHECKLIST.md §3). -->
      <div v-if="status === 'idle' || status === 'loading'" data-testid="read-skeleton" class="max-w-measure" aria-hidden="true">
        <USkeleton class="h-9 w-2/3" />
        <div class="mt-6 space-y-3">
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-5/6" />
        </div>
        <div class="mt-6 space-y-3">
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-2/3" />
        </div>
      </div>

      <div v-else-if="status === 'forbidden'" role="status" class="flex items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-lock" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <h1 class="text-headline-small text-highlighted">You don't have access to this page</h1>
          <p class="text-body-medium text-muted mt-2">
            Ask a workspace admin to grant you access, or go back to a page you can already read.
          </p>
        </div>
      </div>

      <div v-else-if="status === 'not-found'" role="status" class="flex items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-file-question" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <h1 class="text-headline-small text-highlighted">This page does not exist</h1>
          <p class="text-body-medium text-muted mt-2">It may have been moved or deleted.</p>
        </div>
      </div>

      <div v-else-if="status === 'network-error'" role="alert" class="flex items-start gap-3 rounded-lg bg-error-container p-6">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
        <div>
          <h1 class="text-headline-small text-on-error-container">Couldn't load this page</h1>
          <p class="text-body-medium text-on-error-container mt-2">{{ message }}</p>
          <UButton data-testid="read-retry" class="mt-4" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">
            Retry
          </UButton>
        </div>
      </div>

      <!-- Success: the page's own `<h1>` (its title), then the cached
           HTML body as-is (already sanitised at render time, design.md
           D12) — the Markdown parser and the ProseMirror editor are never
           invoked for this request. `max-w-measure` holds the 65-80ch
           reading band (docs/UI-CHECKLIST.md §4.4). -->
      <div v-else class="max-w-measure">
        <PageHeading :heading="title" />
        <!-- eslint-disable-next-line vue/no-v-html -- `html` is server-produced by remark-rehype + rehype-sanitize with an explicit allowlist (design.md D12); it is never client-supplied or user-editable at this route. -->
        <article class="doc-body text-doc-body text-default" v-html="html" />
      </div>
    </UContainer>
  </AppShell>
</template>

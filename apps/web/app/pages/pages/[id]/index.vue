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

    <!-- `max-w-measure` on the column, not on the success branch alone:
         before this, the denied, missing and failed states rendered 1216px
         wide while the document beside them rendered 659px, so the screen
         changed column width with its state (docs/UI-CHECKLIST.md §4.4). -->
    <UContainer class="py-10 sm:py-16">
      <div class="max-w-measure">
        <!-- Loading: a skeleton matched to the real layout (a title line
             plus paragraph-shaped lines), not a spinner — the document's
             shape is known in advance (docs/UI-CHECKLIST.md §3). -->
        <div v-if="status === 'idle' || status === 'loading'" data-testid="read-skeleton" aria-hidden="true">
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

        <PageNotice
          v-else-if="status === 'forbidden'"
          icon="i-lucide-lock"
          heading="You don't have access to this page"
        >
          Ask a workspace admin to grant you access, or go back to a page you can already read.
        </PageNotice>

        <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-file-question" heading="This page does not exist">
          It may have been moved or deleted.
        </PageNotice>

        <PageNotice
          v-else-if="status === 'network-error'"
          icon="i-lucide-circle-alert"
          heading="Couldn't load this page"
          tone="error"
          role="alert"
        >
          {{ message }}
          <template #actions>
            <UButton data-testid="read-retry" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">
              Retry
            </UButton>
          </template>
        </PageNotice>

        <!-- Success: the page's own `<h1>` (its title), then the cached
             HTML body as-is (already sanitised at render time, design.md
             D12) — the Markdown parser and the ProseMirror editor are never
             invoked for this request. The column's `max-w-measure` holds the
             65-80ch reading band (docs/UI-CHECKLIST.md §4.4). -->
        <template v-else>
          <PageHeading :heading="title" />
          <!-- eslint-disable-next-line vue/no-v-html -- `html` is server-produced by remark-rehype + rehype-sanitize with an explicit allowlist (design.md D12); it is never client-supplied or user-editable at this route. -->
          <article class="doc-body text-doc-body text-default" v-html="html" />
        </template>
      </div>
    </UContainer>
  </AppShell>
</template>

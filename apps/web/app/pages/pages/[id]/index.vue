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

/**
 * Whether the app bar may offer the page's other two surfaces at all.
 *
 * `forbidden` and `not-found` are the two states where every route that
 * takes this node id can only refuse: `/edit` denies, and `/history`
 * answers with the byte-identical not-found the API deliberately returns
 * for both absence and denial. Offering either is a dead end, not a
 * transition (docs/UI-CHECKLIST.md §3, "Disabled" — a control with no
 * honest enabled state is worse than absent). Loading and network-error
 * are transient and keep both: the page may well resolve into one that
 * has an editor and a history.
 *
 * One predicate, not one per control: the same rule written twice is two
 * chances to drift (checklist §4.1).
 */
const offersPageSurfaces = computed(() => status.value !== 'forbidden' && status.value !== 'not-found');

onMounted(() => {
  void load();
});

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: () => (title.value ? `${title.value} — deep-wiki` : 'deep-wiki') });
</script>

<template>
  <AppShell>
    <template #header-end>
      <!-- The way to this page's revision history. Until now `/pages/:id/
           history` was reachable only by typing the URL — a screen nobody
           can navigate to is not shipped, which is this repository's
           twice-repeated "route module nobody mounts" arriving one layer
           up (scripts/checks/routes-mounted.ts).

           It sits here, in the app bar, because that is where this page's
           *other* view already lives: read/edit is the transition the
           chrome carries, and history is the third view of the same node,
           not content about it. checklist §4.1 asks a new control to match
           the nearest existing one rather than invent a place, and the
           nearest one is 6px to the right. Read mode is ~95% of this
           product's traffic (docs/SPECS.md §5.3), so the chrome added here
           is paid on every page view — one 28px control, at the quietest
           emphasis the ladder has (`ghost` is M3's Text button,
           docs/DESIGN-SYSTEM.md §9.1), before the emphasised Edit, the
           same order edit mode already uses for "Read" then "Save".

           Icon-only, which checklist §4.3 allows only "where space
           genuinely forbids" a visible label — so it was measured, not
           assumed, and then re-measured with the control in place, which
           corrected the figure: at 320x900 the bar holds the brand
           (ending x=151), this control (172-200), "Edit" (206-270) and
           the theme toggle (276-304), with a 16px right margin. The slack
           is the single 21px gap between brand and history -- not the
           55px counted before this button existed, which it consumed 34px
           of. A labelled "History" needs ~70px against those 21, so the
           exception binds harder than the first measurement suggested;
           what is gone is any headroom for a fourth control at this width.
           §4.3's exception therefore binds, and it demands *both* halves —
           an accessible name and a tooltip — because the same glyph is
           ambiguous across icon packs. "Revision history", not "History":
           the name has to survive being read on its own, and it is the
           `<h1>` of the screen it lands on. -->
      <UTooltip v-if="offersPageSurfaces" text="Revision history">
        <UButton
          icon="i-lucide-history"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Revision history"
          :to="`/pages/${nodeId}/history`"
        />
      </UTooltip>

      <!-- Withheld on forbidden/not-found: offering an action the next
           screen can only refuse is a dead end, not a transition
           (docs/UI-CHECKLIST.md §3, "Disabled" — a control with no honest
           enabled state is worse than absent). Kept during loading and
           network-error: both are transient, and the page may well be
           editable once it resolves. -->
      <UButton
        v-if="offersPageSurfaces"
        icon="i-lucide-pencil"
        variant="soft"
        color="primary"
        size="sm"
        :to="`/pages/${nodeId}/edit`"
      >
        Edit
      </UButton>
    </template>

    <!-- The column is `AppShell`'s `measure`, its default: this screen is
         prose, and the reading measure is what prose takes
         (docs/DESIGN-SYSTEM.md §2.4, checklist §4.4's 65-80 characters).
         It holds for *every* state, not for the success branch alone —
         before the column was one thing, the denied, missing and failed
         panels rendered 1216px wide while the document beside them rendered
         659px, so the screen changed width with its state. -->

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
         invoked for this request. -->
    <template v-else>
      <PageHeading :heading="title" />
      <!-- eslint-disable-next-line vue/no-v-html -- `html` is server-produced by remark-rehype + rehype-sanitize with an explicit allowlist (design.md D12); it is never client-supplied or user-editable at this route. -->
      <article class="doc-body text-doc-body text-default" v-html="html" />
    </template>
  </AppShell>
</template>

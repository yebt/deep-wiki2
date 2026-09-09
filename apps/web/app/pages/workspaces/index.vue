<script setup lang="ts">
/**
 * The workspace list — the screen the product starts from. Until it
 * existed, `/workspaces/:id/tree` could only be reached by someone who
 * already knew an id, so the only way into any content was a hand-written
 * database query.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a signed-in member arriving at the app with nothing selected —
 *   most often someone who has just accepted an invitation, or who opened
 *   a bookmark to the root.
 * - Goal, in their words: "Open the wiki I work in."
 * - Single primary action: open a workspace. There is exactly one, and
 *   every row is it; there is no create/rename/leave affordance competing
 *   with it here.
 * - Data: `workspaces.name`, `workspaces.slug` and the id the tree link is
 *   built from — the three fields `GET /workspaces` returns, and nothing
 *   designed against data that does not exist. No timestamp is rendered:
 *   `workspaces.updated_at` tracks the row, not the content, so a "last
 *   edited" reading of it would be false, and §4.11 rightly makes an
 *   honest one a piece of work rather than a decoration.
 * - Non-goals: no creation, no settings, no membership management, no
 *   per-workspace content preview.
 * - Empty / overflow: a caller who can open nothing gets the state below;
 *   a long workspace name truncates with the full name on hover and focus
 *   rather than widening the row (§6).
 *
 * **"Nothing you can open" is one state, deliberately.** A caller who
 * belongs to no workspace and a caller who belongs to one they may not
 * read receive byte-identical responses, because distinguishing them would
 * disclose that a workspace exists which they cannot see — the property
 * `apps/api/src/routes/workspaces.ts` is built around. §3 asks first-run
 * and filtered-empty to be distinct; that rule is about a filter the user
 * applied and can clear, and there is no filter on this screen. So the
 * copy below is written to be true under both readings and to name the
 * one action that resolves either: ask for access.
 *
 * `unauthenticated` is separate from the error state for the same reason
 * `useWorkspaces` separates them — the next action is to sign in, and a
 * "Retry" would only fail again.
 */
const { status, workspaces, message, load } = useWorkspaces();

onMounted(() => {
  void load();
});

// The document language is `app.vue`'s, not a screen's (`app.test.ts`
// holds that); only the title is this screen's to state.
useSeoMeta({ title: 'Workspaces — deep-wiki' });
</script>

<template>
  <AppShell>
    <!-- `AppShell`'s default `measure` column — the same one read mode,
         edit mode and the navigation tree stand in. A row here is a single
         line of `body-large` read left to right, exactly the case
         docs/DESIGN-SYSTEM.md §2.4 gives the measure to for the tree, and
         docs/UI-CHECKLIST.md §4.1 asks a new screen to match the nearest
         existing one rather than choose a width of its own. -->
    <PageHeading
      heading="Workspaces"
      description="The wikis you can open. Choosing one shows its navigation tree — every shelf, book, chapter and page you can read."
    />

    <!-- A skeleton, not a spinner: the shape of the answer is known
         (§3), and it occupies the same 40px rows the list will, so
         nothing shifts when the response lands. -->
    <div
      v-if="status === 'idle' || status === 'loading'"
      data-testid="workspace-list-skeleton"
      class="space-y-2"
      aria-hidden="true"
    >
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-10 w-5/6" />
      <USkeleton class="h-10 w-4/6" />
    </div>

    <PageNotice
      v-else-if="status === 'unauthenticated'"
      icon="i-lucide-log-in"
      heading="Sign in to see your workspaces"
      :level="2"
    >
      Your session has ended, or you have not signed in on this device yet.
      <template #actions>
        <UButton to="/login" color="primary" variant="solid" size="lg" icon="i-lucide-log-in">Sign in</UButton>
      </template>
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load your workspaces"
      :level="2"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
      </template>
    </PageNotice>

    <PageNotice
      v-else-if="workspaces.length === 0"
      icon="i-lucide-library-big"
      heading="No workspaces you can open"
      :level="2"
    >
      Nothing has been shared with you yet. A workspace admin can grant you access to a shelf, a
      book or a page, and it will appear here.
    </PageNotice>

    <!-- A container sitting directly on the app ground is M3's Filled
         card, which is `UCard variant="soft"` retargeted to
         `bg-emphasized` — the same component and tone as the auth card and
         the navigation tree's own list (docs/DESIGN-SYSTEM.md §9.4). Never
         `bg-elevated`: that rung belongs to the chrome above it. -->
    <UCard v-else variant="soft" :ui="{ body: 'p-2' }">
      <ul class="space-y-1">
        <li v-for="workspace in workspaces" :key="workspace.id">
          <!-- The row is one 40px tab stop whose visible text is its
               accessible name (§7). Hover, focus and press are the M3
               state layer — a `currentColor` overlay that moves away from
               whatever ground it is drawn on, never a step to another
               surface rung (§5.2). -->
          <ULink
            :to="`/workspaces/${workspace.id}/tree`"
            class="dw-state-layer flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1 text-body-large text-default"
          >
            <UIcon name="i-lucide-library-big" class="size-5 shrink-0 text-muted" aria-hidden="true" />
            <!-- The full name stays available on hover and focus rather
                 than widening the row (§6). -->
            <span class="truncate" :title="workspace.name">{{ workspace.name }}</span>
            <!-- `workspaces.name` is not unique and `slug` is, so the slug
                 is what tells two identically-named workspaces apart. It
                 is supporting text, so it steps down a type role and is
                 dropped at the narrowest widths rather than competing with
                 the name for the same line. -->
            <span class="text-body-small text-muted hidden shrink-0 sm:inline">{{ workspace.slug }}</span>
            <UIcon name="i-lucide-chevron-right" class="ms-auto size-4 shrink-0 text-muted" aria-hidden="true" />
          </ULink>
        </li>
      </ul>
    </UCard>
  </AppShell>
</template>

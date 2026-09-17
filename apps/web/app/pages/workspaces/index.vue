<script setup lang="ts">
/**
 * The workspace chooser. Until it existed, `/workspaces/:id/tree` could
 * only be reached by someone who already knew an id, so the only way into
 * any content was a hand-written database query.
 *
 * **This is now pre-workspace, not the front door.** Since the frame
 * landed (2026-09-15), `/` opens onto the last workspace a signed-in
 * person was in (`useCurrentWorkspace`, a cookie, decided on the server);
 * this screen is reached only when there is no last workspace yet, or by
 * choice, from the sidebar switcher's "All workspaces". Its job is
 * choosing, not reading — the same reason it stays in the document frame
 * rather than the one it is about to enter — so it names no workspace of
 * its own and stands outside "one workspace at a time" (PRODUCT.md).
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a signed-in member with no last workspace remembered — most often
 *   someone who has just accepted an invitation — or anyone who chose "All
 *   workspaces" from the switcher to see everything they can open at once.
 * - Goal, in their words: "Open the wiki I work in, or start a new one."
 * - Single primary action: create a workspace — the screen's one filled
 *   button (docs/DESIGN-SYSTEM.md §9.1), not a colour choice. A row below
 *   it is not a competing action in that sense: it is navigation, and
 *   every row is equally one. Filled is not the empty state's way of
 *   saying "you have nothing, so make one" either — it is deliberately not
 *   conditioned on the list being empty, because "nothing shared with me
 *   yet" and "I should start my own" are different situations and this
 *   screen cannot tell which one the caller is in.
 * - Data: `workspaces.name`, `workspaces.slug` and the id the tree link is
 *   built from — the three fields `GET /workspaces` returns, and nothing
 *   designed against data that does not exist. No timestamp is rendered:
 *   `workspaces.updated_at` tracks the row, not the content, so a "last
 *   edited" reading of it would be false, and a *true* last-activity would
 *   need `GET /workspaces/:id/activity` once per row — an N+1 this screen
 *   deliberately does not pay for a nice-to-have. §4.11 rightly makes an
 *   honest timestamp a piece of work rather than a decoration; absent one,
 *   a plain list is the honest choice over an invented signal.
 * - Non-goals: no settings, no membership management, no per-workspace
 *   content preview; creation happens on its own screen.
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
 * "Retry" would only fail again. Since 2026-09-16 that next action is
 * taken for the person: the screen leaves for sign-in and comes back
 * (`useSignInRedirect`), where it used to show a card with a button.
 */
import { newWorkspaceUrl, workspaceUrl } from '~/utils/routes';

const { status, workspaces, message, load } = useWorkspaces();
const createUrl = newWorkspaceUrl();
// A signed-out visit leaves for sign-in and comes back (`useSignInRedirect`).
useSignInRedirect().redirectWhenSignedOut(status);

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

    <!-- A skeleton, not a spinner: the shape of the answer is known (§3),
         and it occupies the box the loaded list will — the same action
         row above it, the same filled card around it, the same 8px inset
         and the same 40px rows — so nothing shifts when the response
         lands. It used to be three bare bars at the top of the column
         while the loaded rows sat under a 56px action row inside a card
         with 24px of inset: measured 24px up and to the left of where the
         rows landed (audit defect 4, 2026-09-14). The action row is real
         rather than a skeleton of itself — it depends on nothing the
         request returns. -->
    <template v-if="status === 'idle' || status === 'loading'">
      <div class="mb-4 flex flex-wrap items-center justify-end gap-3">
        <UButton :to="createUrl" variant="solid" color="primary" icon="i-lucide-plus">New workspace</UButton>
      </div>
      <UCard variant="soft" :ui="{ body: 'p-2 sm:p-2' }">
        <div data-testid="workspace-list-skeleton" class="space-y-1" aria-hidden="true">
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-10 w-5/6" />
          <USkeleton class="h-10 w-4/6" />
        </div>
      </UCard>
    </template>

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

    <template v-else>
      <!-- The screen's one filled button (§9.1): this screen's job is
           choosing, and creating is the one action here that is not a row
           — a row is navigation, not a competing filled action. 16px below
           it: the 4dp grid (docs/DESIGN-SYSTEM.md §7.3). -->
      <div class="mb-4 flex flex-wrap items-center justify-end gap-3">
        <UButton :to="createUrl" variant="solid" color="primary" icon="i-lucide-plus">New workspace</UButton>
      </div>

      <PageNotice
        v-if="workspaces.length === 0"
        icon="i-lucide-library-big"
        heading="No workspaces you can open"
        :level="2"
      >
        Nothing has been shared with you yet. A workspace admin can grant you access to a shelf, a
        book or a page, and it will appear here — or start a workspace of your own with New workspace above.
      </PageNotice>

      <!-- A container sitting directly on the app ground is M3's Filled
           card, which is `UCard variant="soft"` retargeted to
           `bg-emphasized` — the same component and tone as the auth card and
           the navigation tree's own list (docs/DESIGN-SYSTEM.md §9.4). Never
           `bg-elevated`: that rung belongs to the chrome above it.
           `p-2 sm:p-2`, both: the body ships `p-4 sm:p-6`, and a lone `p-2`
           replaced only the first — 24px of inset from `sm` up, measured on
           2026-09-14 (audit defect 13). -->
      <UCard v-else variant="soft" :ui="{ body: 'p-2 sm:p-2' }">
        <ul class="space-y-1">
          <li v-for="workspace in workspaces" :key="workspace.id">
            <!-- The row is one 40px tab stop whose visible text is its
                 accessible name (§7). Hover, focus and press are the M3
                 state layer — a `currentColor` overlay that moves away from
                 whatever ground it is drawn on, never a step to another
                 surface rung (§5.2). -->
            <ULink
              :to="workspaceUrl(workspace.slug)"
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
    </template>
  </AppShell>
</template>

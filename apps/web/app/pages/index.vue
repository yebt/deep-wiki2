<script setup lang="ts">
/**
 * `/` is the way in, and it opens onto the last workspace the person was
 * in — the workspace list only when there is none.
 *
 * This route was the Phase 0 smoke page, then (2026-09-15, first batch) a
 * redirect to the workspace list. Both put a lobby in front of the room:
 * a person lives in one workspace at a time and comes back to it, the way
 * a person reopens the same Obsidian vault (apps/web/PRODUCT.md), and a
 * front door that leads to a list of doors is a click the product owes
 * on every return. The decision of what stands here was made against
 * docs/UI-CHECKLIST.md rather than by taste:
 *
 * - **Not a second copy of the list, and not a landing.** §4.1: anything
 *   that appears on more than one screen is one component; §2: one
 *   primary action, and a screen whose only action is "go on" is a
 *   redirect with a click in front of it.
 * - **So: a route decision, not a screen.** `middleware/last-workspace.ts`
 *   reads the workspace `useCurrentWorkspace` remembered in its cookie and
 *   sends the person there, or to `/workspaces` when nothing is remembered.
 *   Middleware rather than `definePageMeta({ redirect })` because a static
 *   redirect cannot read a cookie, and this has to resolve on the server
 *   so the list never flashes by on the way in.
 *
 * Signed-out visitors still reach sign-in from the list, which renders its
 * own signed-out state with "Sign in" as the single action rather than
 * bouncing to `/login` and discarding the reason (§3). A remembered
 * workspace they can no longer open lands on the dashboard's "does not
 * exist" state, which offers the list and discloses nothing.
 */
definePageMeta({ middleware: ['last-workspace'] });
</script>

<template>
  <div>
    <!-- Never rendered: the middleware navigates away before this route's
         component is instantiated. -->
  </div>
</template>

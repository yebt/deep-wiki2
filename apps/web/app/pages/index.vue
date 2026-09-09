<script setup lang="ts">
/**
 * `/` sends the visitor to the workspace list.
 *
 * This route was the Phase 0 smoke page — a grid of panels whose own copy
 * said "there is no navigation tree, no editor and no sign-in", long after
 * all three existed. It is now the way in, and the decision of what to put
 * here was made against docs/UI-CHECKLIST.md rather than by taste:
 *
 * - **Not a second copy of the list.** §4.1: anything that appears on more
 *   than one screen is one component, and "a second copy is a defect even
 *   while the two copies are identical, because they will not stay
 *   identical". Rendering the workspace list at `/` *and* at `/workspaces`
 *   is that defect at the granularity of a whole screen.
 * - **Not a landing that links onward.** §2 asks for one primary action; a
 *   landing whose only action is "go to the workspace list" is this
 *   redirect with a click in front of it, and the complaint that produced
 *   this batch was that content could not be reached. §4.4's "chrome is
 *   quieter than content" points the same way: a page carrying no content
 *   of its own is chrome standing where content should be.
 * - **So: a redirect.** The workspace list is the screen, it lives at one
 *   address, and `/` is an alias for it.
 *
 * Signed-out visitors reach sign-in from there: `/workspaces` renders its
 * own signed-out state with "Sign in" as the single action, rather than
 * bouncing to `/login` and discarding the reason (§3 — a route-level
 * failure states what happened and offers a real way forward).
 *
 * `redirect` in `definePageMeta` rather than a `navigateTo` in setup: it
 * is resolved by the router before this component is created, on the
 * server and in the browser alike, so there is no frame in which an empty
 * page is rendered and no second mechanism to keep in step.
 */
definePageMeta({ redirect: '/workspaces' });
</script>

<template>
  <div>
    <!-- Never rendered: the router resolves `redirect` before this route's
         component is instantiated. -->
  </div>
</template>

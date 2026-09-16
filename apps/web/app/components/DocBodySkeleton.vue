<script setup lang="ts">
/**
 * The document body's skeleton — three text lines standing where the
 * prose will, on `doc-body`'s own 26px leading and 16px paragraph
 * rhythm, so the loaded first paragraph lands exactly where the first
 * line stood (docs/UI-CHECKLIST.md §3, "no layout shift on load —
 * measure it"; `e2e/read.spec.ts` and `e2e/editor.spec.ts` hold the
 * response back and measure both boxes).
 *
 * One component for the three places the lines appear: the read screen
 * while the page is fetched, the edit screen while the session is
 * requested, and `EditorSurface` for the last stretch after the session
 * has arrived — chunk evaluation, the first parse, the view — so the
 * box never stands empty between the two. Until 2026-09-16 each was its
 * own copy of the same three lines; §4.1 names a second copy a defect
 * even while identical, because that is how one screen gets a layout
 * fix and the other does not.
 *
 * Not `aria-hidden` here: the screen wraps the skeleton, title line
 * included, in one hidden region, so the whole placeholder is one thing
 * to assistive technology rather than a hidden block beside a spoken one.
 */
withDefaults(
  defineProps<{
    /** Put on the first line, so the screen's measurement (`e2e/*.spec.ts`) can find the box the prose must land in. */
    lineTestId?: string;
  }>(),
  { lineTestId: undefined },
);
</script>

<template>
  <div class="doc-body text-doc-body">
    <!-- `as="span"`: a `<div>` inside a `<p>` is invalid HTML and the
         server-rendered skeleton would be re-parsed with the paragraph
         closed early, losing the 26px line box this exists for. -->
    <p :data-testid="lineTestId"><USkeleton as="span" class="inline-block h-4 w-full align-middle" /></p>
    <p><USkeleton as="span" class="inline-block h-4 w-full align-middle" /></p>
    <p><USkeleton as="span" class="inline-block h-4 w-5/6 align-middle" /></p>
  </div>
</template>

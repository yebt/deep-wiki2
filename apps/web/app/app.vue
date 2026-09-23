<script setup lang="ts">
// The root component renders no screen of its own. It supplies `UApp` —
// the Reka providers every tooltip, modal and toast injects — the layout
// a screen names (`layouts/workspace.vue` is the one that keeps the
// sidebar mounted across navigations inside a workspace; a page that
// names none renders bare, since there is deliberately no `default.vue`),
// the one head value a screen inherits rather than states, the
// product's one confirm dialog (`ConfirmDialog`), mounted once here so
// any screen can ask a question through `useConfirm()` and await the
// answer, the route-change indicator every hop shares, and — inside
// `UApp`'s own toaster — the one surface transient confirmations use
// (`useStatusToast`, 2026-09-23).
import { loadingProgress } from '~/utils/loading-progress';

useHead({
  htmlAttrs: { lang: 'en' },
});

useSeoMeta({
  title: 'deep-wiki',
  description: 'A self-hosted wiki for software teams and the agents that read it.',
});
</script>

<template>
  <!-- `toaster.max`: a confirmation that stacks four deep stops being a
       confirmation and becomes a wall over the document (the owner's
       "estas cosas pueden manejarse como toasts" is about getting the
       banners *out* of the way). Three is the library's five, reduced;
       the rest of the tier — role, politeness, dismissal, how long it
       stays — is `useStatusToast`'s, and where it stands on the stack is
       docs/DESIGN-SYSTEM.md §4.5's top rung. -->
  <UApp :toaster="{ max: 3 }">
    <!-- Route-change feedback (docs/TODO.md Findings 2026-09-16, "edit-mode
         latency": no screen said a hop was in flight, and in dev a
         read → edit hop is 52 module requests). Nuxt's indicator, with
         Nuxt's default gradient replaced by the design system's roles:
         `primary` for the bar (docs/DESIGN-SYSTEM.md §1.2 — the one thing
         that matters while a hop is in flight is that it is in flight)
         and `error` for a hop that failed, both as the `--ui-*` variables
         so every theme's own tone is what renders (§4.2 of the checklist:
         no literal colour). 3px is Nuxt's default and M3's focus-ring
         width; it stays. `throttle` keeps the bar off any hop under
         200 ms, so a warm route never flashes it. The progress curve is
         ours only so reduced motion can be honoured: `main.css` shortens
         the bar's CSS transitions globally, but the growth is JavaScript
         per frame, and `loadingProgress` draws the bar full at once under
         `prefers-reduced-motion` (checklist §5, pass/fail). -->
    <NuxtLoadingIndicator color="var(--ui-primary)" error-color="var(--ui-error)" :height="3" :estimated-progress="loadingProgress" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ConfirmDialog />
  </UApp>
</template>

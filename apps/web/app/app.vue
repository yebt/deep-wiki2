<script setup lang="ts">
// Phase 0 has exactly one route (the smoke page) — see docs/UI-CHECKLIST.md's
// scope note: this is a boot/theming/accessibility proof, not a product
// screen. No navigation tree, editor or auth surface lives here yet.
useHead({
  htmlAttrs: { lang: 'en' },
});

useSeoMeta({
  title: 'deep-wiki — bootstrap status',
  description: 'Phase 0 smoke page proving the deep-wiki web shell boots, is themed, and is accessible.',
});
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>

<script setup lang="ts">
// The root component renders no screen of its own. It supplies `UApp` —
// the Reka providers every tooltip, modal and toast injects — the layout
// a screen names (`layouts/workspace.vue` is the one that keeps the
// sidebar mounted across navigations inside a workspace; a page that
// names none renders bare, since there is deliberately no `default.vue`),
// the one head value a screen inherits rather than states, and the
// product's one confirm dialog (`ConfirmDialog`), mounted once here so
// any screen can ask a question through `useConfirm()` and await the
// answer.
useHead({
  htmlAttrs: { lang: 'en' },
});

useSeoMeta({
  title: 'deep-wiki',
  description: 'A self-hosted wiki for software teams and the agents that read it.',
});
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ConfirmDialog />
  </UApp>
</template>

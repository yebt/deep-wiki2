<script setup lang="ts">
// The root component renders no screen of its own. It supplies `UApp` —
// the Reka providers every tooltip, modal and toast injects — and the one
// head value a screen inherits rather than states.
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
    <NuxtPage />
  </UApp>
</template>

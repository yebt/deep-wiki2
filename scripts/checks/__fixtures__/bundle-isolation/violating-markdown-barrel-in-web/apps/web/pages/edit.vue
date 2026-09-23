<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const MilkdownEditor = defineAsyncComponent(() => import('@deep-wiki/editor/mount'));
</script>

<template>
  <MilkdownEditor />
</template>

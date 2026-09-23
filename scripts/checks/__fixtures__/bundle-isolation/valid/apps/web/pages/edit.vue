<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
// The browser-safe subpath, which is what a web-side consumer may have:
// `pipeline.ts` carries no `node:crypto` and no syntax highlighter. The
// barrel beside it is what rule 3 forbids here.
import { parse } from '@deep-wiki/markdown/pipeline';

const MilkdownEditor = defineAsyncComponent(() => import('@deep-wiki/editor/mount'));
const tree = parse('# hi\n');
</script>

<template>
  <MilkdownEditor :tree="tree" />
</template>

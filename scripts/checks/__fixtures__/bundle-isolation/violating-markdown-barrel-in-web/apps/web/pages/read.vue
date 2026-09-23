<script setup lang="ts">
// The violation: the read screen reaching the markdown barrel, which
// reaches render() — and with it the highlighter's grammars and
// node:crypto. `@deep-wiki/markdown/pipeline` is the subpath a browser
// consumer may have.
import { render } from '@deep-wiki/markdown';

const html = render('# hi\n');
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <article v-html="html" />
</template>

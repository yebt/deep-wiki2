<script setup lang="ts">
/**
 * The eyebrow / `<h1>` / description block shared by every product screen,
 * and the one place that owns the three distances docs/DESIGN-SYSTEM.md
 * §7.4 specifies for it: no gap between eyebrow and heading beyond the
 * type scale's own leading, `mt-1` from heading to description, and
 * `mb-8` (32px) from this whole block to whatever container sits below it
 * — one grid step past that container's own 24px inset, which is what
 * keeps the heading reading as outside the card rather than as its title.
 *
 * `eyebrow` is optional and must add context the heading does not
 * (docs/UI-CHECKLIST.md's 2026-09-04 review log: a repeated paraphrase of
 * the heading spends hierarchy for nothing) — e.g. a breadcrumb-shaped
 * location ("Acme / Handbook"), not a restatement of the page title.
 */
defineProps<{
  heading: string;
  eyebrow?: string;
  description?: string;
}>();
</script>

<template>
  <div class="mb-8">
    <p v-if="eyebrow" class="text-label-large text-muted">{{ eyebrow }}</p>
    <h1 class="text-headline-medium text-highlighted" :class="eyebrow ? 'mt-1' : ''">{{ heading }}</h1>
    <p v-if="description" class="text-body-large text-muted mt-1">{{ description }}</p>
  </div>
</template>

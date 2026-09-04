<script setup lang="ts">
/**
 * Shared chrome for the three authentication screens (sign-in, invitation
 * accept, password reset). Extends the pattern already established by
 * `pages/index.vue` — same header/footer shape, same M3 type roles and
 * surface tokens — rather than inventing a second layout system
 * (docs/UI-CHECKLIST.md §1, "extend the system, do not invent one").
 *
 * The page that uses this shell owns the actual page `<h1>` (passed as
 * `heading`) — `UAuthForm`'s own `title` prop renders a `<div>`, not a
 * heading element, so it is never used for the page's primary heading.
 */
defineProps<{
  eyebrow: string;
  heading: string;
  description?: string;
}>();
</script>

<template>
  <div>
    <UHeader :toggle="false">
      <template #left>
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-library-big" class="size-5 text-primary" aria-hidden="true" />
          <span class="text-title-large text-highlighted">deep-wiki</span>
        </span>
      </template>
      <template #right>
        <UTooltip text="Toggle color theme">
          <UColorModeButton aria-label="Toggle color theme" />
        </UTooltip>
      </template>
    </UHeader>

    <UMain>
      <UContainer class="py-10 sm:py-16">
        <div class="mx-auto w-full max-w-md">
          <p class="text-label-large text-muted">{{ eyebrow }}</p>
          <h1 class="text-headline-medium text-highlighted mt-2">{{ heading }}</h1>
          <p v-if="description" class="text-body-large text-muted mt-3">
            {{ description }}
          </p>

          <UCard variant="outline" class="mt-8">
            <slot />
          </UCard>
        </div>
      </UContainer>
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-body-small text-muted">deep-wiki</p>
      </template>
      <template #right>
        <p class="text-body-small text-muted">Material Design 3 · Nuxt UI v4</p>
      </template>
    </UFooter>
  </div>
</template>

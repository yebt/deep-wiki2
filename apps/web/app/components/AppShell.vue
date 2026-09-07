<script setup lang="ts">
/**
 * Shared chrome for every signed-in product screen (read mode, edit mode,
 * the navigation tree). Extends `AuthShell`'s proven header/main/footer
 * column rather than inventing a second layout system
 * (docs/UI-CHECKLIST.md §1, "extend the system, do not invent one") —
 * same brand mark, same theme toggle, same full-height column.
 *
 * `UMain`'s own base is `min-h-[calc(100vh-var(--ui-header-height))]` —
 * viewport minus the header, with no allowance for the footer — which is
 * exactly the vertical-overflow trap `AuthShell` had to work around
 * per-instance (docs/UI-CHECKLIST.md's 2026-09-04 review log entry).
 * `app.config.ts`'s `main.base` fixes it centrally
 * (`flex min-h-0 flex-1 flex-col`) so every screen built on this shell
 * gets the fix for free and never has to restate it.
 */
defineProps<{
  /** The page's own `<h1>` lives in `PageHeading`, not here — this is chrome, not content. */
  brand?: string;
}>();
</script>

<template>
  <div class="flex min-h-svh flex-col">
    <UHeader :toggle="false">
      <template #left>
        <NuxtLink to="/" class="flex items-center gap-2">
          <UIcon name="i-lucide-library-big" class="size-5 text-primary" aria-hidden="true" />
          <span class="text-title-large text-highlighted">{{ brand ?? 'deep-wiki' }}</span>
        </NuxtLink>
      </template>
      <template #right>
        <!-- Page-specific chrome (Edit/Read toggle, Save, presence) sits
             here, to the left of the theme toggle every screen shares. -->
        <slot name="header-end" />
        <UTooltip text="Toggle color theme">
          <UColorModeButton aria-label="Toggle color theme" />
        </UTooltip>
      </template>
    </UHeader>

    <UMain>
      <slot />
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

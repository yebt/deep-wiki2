<script setup lang="ts">
/**
 * The application chrome: the full-height column, the top app bar and the
 * footer. Every route renders inside this component and nothing else
 * declares a `UHeader` or a `UFooter`.
 *
 * It exists because the chrome was previously written twice — once in
 * `pages/index.vue` and once in `AuthShell.vue` — and the two copies
 * drifted: the footer said "deep-wiki bootstrap · Phase 0" on one screen
 * and "deep-wiki" on the other, and only one of them carried the
 * full-height fix below. Shared chrome that is re-typed per screen is not
 * shared (docs/UI-CHECKLIST.md §1, "extend the system, do not invent one";
 * §6, cross-screen consistency).
 *
 * Height: `min-h-svh` plus a column, with `UMain` taking the remainder.
 * `UMain`'s own base is `min-h-[calc(100vh-var(--ui-header-height))]` —
 * viewport minus the header, with no allowance for a footer — so any page
 * pairing the two overflows by exactly the footer's height (49px at
 * 1280x900). That base is replaced centrally in `app.config.ts` with
 * `min-h-0 flex-1`, which is only correct inside this column; the two
 * belong together and both are stated once.
 */
</script>

<template>
  <div class="flex min-h-svh flex-col">
    <!-- `:toggle="false"`: `UHeader` renders a hamburger that opens a
         mobile menu built from its `#body` slot. No route has a
         navigation tree yet, so the default toggle would be a control
         that looks clickable and does nothing (docs/UI-CHECKLIST.md §6,
         observable breakage). -->
    <UHeader :toggle="false">
      <template #left>
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-library-big" class="size-5 text-primary" aria-hidden="true" />
          <span class="text-title-large text-highlighted">deep-wiki</span>
        </span>
      </template>
      <template #right>
        <!-- The only icon-only control in the chrome. docs/UI-CHECKLIST.md
             §4.3 requires both an accessible name and a tooltip, because
             the same glyph is ambiguous across icon packs. -->
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

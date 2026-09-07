<script setup lang="ts">
/**
 * The application chrome: the full-height column, the top app bar and the
 * footer. Every route renders inside this component and nothing else
 * declares a `UHeader` or a `UFooter`.
 *
 * It exists because the chrome was previously written three times — in
 * `pages/index.vue`, in `AuthShell.vue` and here — and the copies drifted:
 * the footer said "deep-wiki bootstrap · Phase 0" on one screen and
 * "deep-wiki" on the others, and the theme toggle rendered 40px tall
 * beside the 32px chrome buttons the product screens put next to it.
 * Shared chrome that is re-typed per screen is not shared
 * (docs/UI-CHECKLIST.md §4.1; §1, "extend the system, do not invent one").
 *
 * Height: `min-h-svh` plus a column, with `UMain` taking the remainder.
 * `UMain`'s own base is `min-h-[calc(100vh-var(--ui-header-height))]` —
 * viewport minus the header, with no allowance for a footer — so any page
 * pairing the two overflows by exactly the footer's height (49px at
 * 1280x900). That base is replaced centrally in `app.config.ts` with
 * `flex min-h-0 flex-1 flex-col`, which is only correct inside this
 * column; the two belong together and both are stated once.
 */
</script>

<template>
  <div class="flex min-h-svh flex-col">
    <!-- `:toggle="false"`: `UHeader` renders a hamburger that opens a
         mobile menu built from its `#body` slot. No route mounts a
         navigation tree into the chrome yet, so the default toggle would
         be a control that looks clickable and does nothing
         (docs/UI-CHECKLIST.md §6, observable breakage). -->
    <UHeader :toggle="false">
      <template #left>
        <!-- The brand is the way back from any screen, so it is a link
             rather than a label — and an interactive element carries a
             state layer like every other one (docs/DESIGN-SYSTEM.md §5.2).
             The negative inset keeps the layer's box on the shape scale
             without moving the mark itself. -->
        <NuxtLink to="/" class="dw-state-layer -mx-2 flex items-center gap-2 rounded-md px-2 py-1">
          <UIcon name="i-lucide-library-big" class="size-5 text-primary" aria-hidden="true" />
          <span class="text-title-large text-highlighted">deep-wiki</span>
        </NuxtLink>
      </template>
      <template #right>
        <!-- Page-specific chrome (the Read/Edit transition, Save, presence)
             sits to the left of the theme toggle every screen shares, and
             takes §7.2's 32px chrome height. -->
        <slot name="header-end" />
        <!-- The only icon-only control in the chrome. docs/UI-CHECKLIST.md
             §4.3 requires both an accessible name and a tooltip, because
             the same glyph is ambiguous across icon packs.
             `size="sm"`: `UColorModeButton` forwards to the `button` theme
             and inherits its `md` default — 40px, §7.2's *content-area*
             height. Left alone it rendered 40px next to 32px chrome
             buttons in the same bar. -->
        <UTooltip text="Toggle color theme">
          <UColorModeButton size="sm" aria-label="Toggle color theme" />
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

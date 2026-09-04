<script setup lang="ts">
/**
 * Shared chrome for the four authentication screens (sign-in, password
 * reset request, password reset confirm, invitation accept). Extends the
 * pattern already established by `pages/index.vue` — same header/footer
 * shape, same M3 type roles and surface tokens — rather than inventing a
 * second layout system (docs/UI-CHECKLIST.md §1, "extend the system, do
 * not invent one").
 *
 * The page that uses this shell owns the actual page `<h1>` (passed as
 * `heading`) — `UAuthForm`'s own `title` prop renders a `<div>`, not a
 * heading element, so it is never used for the page's primary heading.
 * There is deliberately no eyebrow above it: an eyebrow exists to supply
 * context the heading does not, and on these four screens every honest
 * eyebrow was a paraphrase of the `h1` beneath it.
 */
defineProps<{
  heading: string;
  description?: string;
}>();
</script>

<template>
  <!-- Full-height column: header and footer at their natural heights, the
       main region taking whatever is left. `UMain`'s own base is
       `min-h-[calc(100vh-var(--ui-header-height))]` — viewport minus the
       header, with no allowance for the footer — which put the footer's
       top border exactly on the fold and gave every auth page permanent
       vertical scroll (49px at 1280×900, 121px at 320×900) on a form
       that fits several times over. `flex-1` replaces that calculation
       with the actual remaining space, so nothing has to know either
       chrome's height (docs/UI-CHECKLIST.md §6). -->
  <div class="flex min-h-svh flex-col">
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

    <UMain class="flex min-h-0 flex-1 flex-col">
      <!-- `my-auto` centres the block in the space that is left, and is
           the one centring idiom that degrades correctly: auto margins
           only absorb *positive* free space, so once the content is
           taller than the region — a narrow viewport, 200% zoom, the
           three-field invitation form with errors showing — they collapse
           to zero and the block stays top-aligned and fully reachable
           instead of overflowing symmetrically off both edges. -->
      <UContainer class="my-auto py-10 sm:py-16">
        <div class="mx-auto w-full max-w-md">
          <h1 class="text-headline-medium text-highlighted">{{ heading }}</h1>
          <p v-if="description" class="text-body-large text-muted mt-3">
            {{ description }}
          </p>

          <!-- M3's Filled card (§9.4): `surface-container-highest`,
               elevation 0. The Outlined card is `surface` plus a
               hairline, which on these screens is a container sitting
               directly on the app ground with nothing but an
               `outline-variant` rule to say so — 1.14:1 against the
               ground in dark, where it read as a hole rather than a
               card. `variant="soft"` is retargeted to the opaque
               container token centrally, in app.config.ts. -->
          <UCard variant="soft" class="mt-8">
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

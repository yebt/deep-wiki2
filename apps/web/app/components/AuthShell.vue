<script setup lang="ts">
/**
 * The layout shared by the four authentication screens (sign-in, password
 * reset request, password reset confirm, invitation accept): the app
 * chrome, a centred column, the page heading block and the card that
 * holds the form.
 *
 * The chrome itself is `AppShell` and the heading block is `PageHeading`
 * — both shared with `/`, so a change to either lands on every screen at
 * once. What is left here is only what is specific to an auth screen: the
 * `max-w-md` column and the card.
 *
 * The page that uses this shell owns the actual page `<h1>` (passed as
 * `heading`) — `UAuthForm`'s own `title` prop renders a `<div>`, not a
 * heading element, so it is never used for the page's primary heading.
 */
defineProps<{
  heading: string;
  description?: string;
}>();
</script>

<template>
  <AppShell>
    <!-- `my-auto` centres the block in the space `UMain` leaves, and is
         the one centring idiom that degrades correctly: auto margins only
         absorb *positive* free space, so once the content is taller than
         the region — a narrow viewport, 200% zoom, the three-field
         invitation form with errors showing — they collapse to zero and
         the block stays top-aligned and fully reachable instead of
         overflowing symmetrically off both edges. -->
    <UContainer class="my-auto py-10 sm:py-16">
      <div class="mx-auto w-full max-w-md">
        <PageHeading :heading="heading" :description="description" />

        <!-- M3's Filled card (§9.4): `surface-container-highest`,
             elevation 0. The Outlined card is `surface` plus a hairline,
             which on these screens is a container sitting directly on the
             app ground with nothing but an `outline-variant` rule to say
             so — 1.14:1 against the ground in dark, where it read as a
             hole rather than a card. `variant="soft"` is retargeted to
             the opaque container token centrally, in app.config.ts. -->
        <UCard variant="soft">
          <slot />
        </UCard>
      </div>
    </UContainer>
  </AppShell>
</template>

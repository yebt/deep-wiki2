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
 * The heading block itself is `PageHeading`, which owns the three
 * distances (eyebrow → h1, h1 → description, block → container) so they
 * cannot drift from the product screens' the way they did while this file
 * spelled them out itself. There is deliberately no eyebrow on these four
 * screens: an eyebrow exists to supply context the heading does not, and
 * here every honest one was a paraphrase of the `h1` beneath it.
 */
defineProps<{
  heading: string;
  description?: string;
}>();
</script>

<template>
  <!-- The chrome — the full-height column, the app bar and the footer —
       is `AppShell`'s, not this component's. It was written here too until
       2026-09-07, and the copies drifted: this one rendered the brand as
       an inert `<span>` and the theme toggle at 40px, `AppShell` rendered
       a link and (after the review) 32px. What is left here is the only
       thing that is genuinely the auth screens' own: which of the shell's
       columns they stand in, and a card in it (docs/UI-CHECKLIST.md §4.1 —
       anything on more than one screen is one component, not one copy per
       screen). -->
  <!-- `column="narrow"` is `max-w-md`; `center` is the `my-auto` that
       centres the block in the vertical space left over. Both were spelled
       out here, along with the `UContainer` every other screen also spelled
       out for itself, until the shell took the column on 2026-09-07 — the
       same move, and the same reason, as the chrome above. -->
  <AppShell column="narrow" center>
    <PageHeading :heading="heading" :description="description" />

    <!-- M3's Filled card (§9.4): `surface-container-highest`, elevation 0.
         The Outlined card is `surface` plus a hairline, which on these
         screens is a container sitting directly on the app ground with
         nothing but an `outline-variant` rule to say so — 1.14:1 against
         the ground in dark, where it read as a hole rather than a card.
         `variant="soft"` is retargeted to the opaque container token
         centrally, in app.config.ts. The 32px to this card is
         `PageHeading`'s `mb-8` (§7.4). -->
    <UCard variant="soft">
      <slot />
    </UCard>
  </AppShell>
</template>

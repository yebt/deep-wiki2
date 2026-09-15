<script setup lang="ts">
/**
 * The sign-in family's own shell — sign-in, password reset request, password
 * reset confirm, invitation accept. A person meets one of these screens
 * *before* they have entered the product, so it draws nothing that belongs
 * to a signed-in product: no top app bar, no brand link back to a room the
 * visitor is not in, no registration entry, no footer. What is left is what
 * a sign-in is — the product's mark and name as the one thing to recognise,
 * the page's heading, and a card holding the form — on the app ground,
 * centred in the viewport.
 *
 * Until 2026-09-15 this component rendered inside `AppShell`, and the four
 * screens looked like one more page of a product the visitor had not
 * entered yet: a header with the brand and the theme toggle, a footer, and
 * a form in a narrow card between them. The owner's words were "haz que el
 * login sea un login". This shell no longer depends on `AppShell` at all —
 * deliberately, so the two can change independently and so nothing the
 * app chrome grows (a search, a workspace switcher, a presence chip) can
 * leak onto a screen shown to someone who has not signed in.
 *
 * ## Composition: a centred card, not a split
 *
 * Both a centred card and a split (mark on one side, form on the other)
 * are honest for this product; the choice comes from what the design
 * system gives. docs/DESIGN-SYSTEM.md §2.3 discards the `display-*` roles
 * outright ("a wiki has none"), §12.7 forbids decorative motion, and
 * `PRODUCT.md`'s Evidence on Hand says there is no imagery, no customer
 * and no benchmark to put on the other half of a split. A split would
 * therefore be half a screen of empty ground with a mark on it — a hero
 * with nothing to say. The centred composition is what the system has
 * already ruled for these screens: the `narrow` column (§2.4), the Filled
 * card on the app ground (§9.4), the 32px heading rhythm (§7.4). The
 * craft is in the composition, not in an invented second half.
 *
 * ## What each part is
 *
 * - **The mark.** `i-lucide-library-big` in `primary` beside "deep-wiki"
 *   in `title-large` — the same lockup as the app bar's brand, so it is
 *   recognised on the far side of the sign-in. Here it is *not a link*:
 *   there is no "back" for someone who has not signed in, and a control
 *   that looks clickable and leads nowhere is docs/UI-CHECKLIST.md §6's
 *   inert interaction. 32px to the heading block, the same distance the
 *   heading block keeps to the card (§7.4), so the column reads as three
 *   objects on one rhythm: identity, action, form.
 * - **The heading block** is `PageHeading`, unchanged: one `<h1>`, an
 *   optional supporting sentence, and no eyebrow (2026-09-04 review).
 * - **The card** is M3's Filled card, `UCard variant="soft"` retargeted to
 *   `bg-emphasized` centrally (§9.4). Elevation 0, no shadow (§4.3):
 *   hierarchy is the tone step from the `bg-muted` ground, which the
 *   2026-09-04 review measured at 1.48:1 in dark after the tone fix.
 * - **The theme toggle** stays, because a person signing in at night
 *   deserves dark, but it is not a header. It is one 32px ghost control in
 *   the top-end corner, absolutely positioned so it takes no space from
 *   the column, named and tooltipped (§4.3), and first in the DOM because
 *   it is first in visual order (§5). It is the only control on the
 *   screen outside the card.
 *
 * ## Height
 *
 * `min-h-svh` on the column, `UMain` taking the remainder (its base is
 * replaced centrally in `app.config.ts` with `flex min-h-0 flex-1 flex-col`,
 * which is correct inside any `min-h-svh` column, this one included), and
 * `my-auto` on the container so the block centres in the space it has and
 * a block taller than the viewport stays top-aligned and reachable.
 * `e2e/auth-layout.spec.ts` measures `scrollHeight === innerHeight` on all
 * four screens at 1280x900 and 320x900 — the check that caught the
 * `UMain` + `UFooter` trap on 2026-09-04, kept even though there is no
 * footer here any more, because a measurement is the only thing that
 * catches this class.
 */
defineProps<{
  heading: string;
  description?: string;
}>();
</script>

<template>
  <div class="relative flex min-h-svh flex-col">
    <!-- `UColorModeButton` forwards to the `button` theme and would inherit
         the 40px `md` default; `size="sm"` is §7.2's 32px chrome height,
         the same the app bar's toggle renders at, so the two never read as
         different controls. -->
    <div class="absolute end-4 top-4 sm:end-6 sm:top-6">
      <UTooltip text="Toggle color theme">
        <UColorModeButton size="sm" aria-label="Toggle color theme" />
      </UTooltip>
    </div>

    <UMain>
      <!-- The gutter is M3's layout margin — 16px compact, 24px from
           medium up (docs/DESIGN-SYSTEM.md §7.1) — which `UContainer`
           already ships. `narrow` is §2.4's column for one card holding a
           short form; `mx-auto` centres it, `my-auto` centres the block in
           the leftover height. -->
      <UContainer class="my-auto py-10 sm:py-16">
        <div class="mx-auto w-full max-w-md">
          <p class="mb-8 flex items-center gap-2">
            <UIcon name="i-lucide-library-big" class="size-6 text-primary" aria-hidden="true" />
            <span class="text-title-large text-highlighted">deep-wiki</span>
          </p>

          <PageHeading :heading="heading" :description="description" />

          <UCard variant="soft">
            <slot />
          </UCard>
        </div>
      </UContainer>
    </UMain>
  </div>
</template>

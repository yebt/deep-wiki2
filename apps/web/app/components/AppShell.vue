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
 *
 * Width: the shell owns it too, for the same reason it owns the height.
 * `UMain` has no width of its own, so until 2026-09-07 every screen wrote
 * its own `UContainer` and its own column `div` — and being written five
 * times, they were five chances to drift. They already had: measured at
 * 1280x900, the read, edit and tree columns rendered 658.9px wide at
 * x=32 with 589px of empty page to their right, because `max-w-measure`
 * caps a width and centres nothing. The right half of a wide screen was
 * unused on every product screen at once.
 *
 * Three columns exist, and the screen names which kind it is rather than
 * restating a number:
 *
 *   `measure`  72ch (docs/DESIGN-SYSTEM.md §2.4) — the reading measure,
 *              which checklist §4.4 requires to land at 65-80 characters.
 *              Read mode is prose and takes it by definition; edit mode
 *              takes the *same* column because switching modes must not
 *              move the text under the cursor; and the navigation tree
 *              takes it because a tree row is one line of `body-large`
 *              set left-to-right, and a label that starts at x=0 and ends
 *              at x=1216 is the scanning problem the measure exists to
 *              solve. §2.4's exemptions — tables, code blocks, diagrams —
 *              are content that *exceeds* the measure and scrolls inside
 *              its own box; a tree under-fills it, which is not the same
 *              case. This is also the one width the product has, and
 *              checklist §4.1 asks a new screen to match the nearest
 *              existing one rather than pick its own.
 *   `narrow`   `max-w-md` — a single card holding a short form. The four
 *              auth screens, through `AuthShell`.
 *   `wide`     the container's own `--ui-container` (80rem). For a screen
 *              whose content is a grid of panels rather than a document.
 *              §2.4 is explicit that `--ui-container` is the app shell's
 *              max width and **not** the reading measure, so a screen on
 *              this column still gets its prose measured: `PageHeading`
 *              caps its own block at `max-w-measure`.
 *
 * `center` adds `my-auto`, which only absorbs *positive* free space, so a
 * block taller than the region stays top-aligned and fully reachable
 * instead of overflowing off both edges.
 */
const props = withDefaults(
  defineProps<{
    column?: 'narrow' | 'measure' | 'wide';
    center?: boolean;
  }>(),
  { column: 'measure', center: false },
);

const COLUMNS = {
  narrow: 'mx-auto w-full max-w-md',
  measure: 'mx-auto w-full max-w-measure',
  wide: 'w-full',
} as const;

const columnClass = computed(() => COLUMNS[props.column]);
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
        <!--
          `/admin/registration` was reachable only by typing the URL
          (docs/TODO.md, "a screen nobody can navigate to is not shipped").
          It belongs in the chrome, not on any one screen, because the
          caller it is for — the Super Root — may be looking at any
          workspace when they need it.

          Meant to be gated on `is_super_root`, which lives on the users
          table and is checked server-side in
          `apps/api/src/routes/admin.ts`'s `requireSuperRoot` — but nothing
          in any response this client already holds carries that flag, and
          there is no `GET /me`-shaped endpoint to ask instead (confirmed
          by reading `apps/api/src/index.ts`'s route table, not assumed).
          Adding that field is outside this task's file ownership (`apps/api`
          belongs to a concurrent agent); see docs/TODO.md for the gap.

          So this renders for **every** caller — a deliberate fallback, not
          a permission check. `/admin/registration` already answers a
          non-operator with its own honest "This is the instance operator's"
          state, so the cost is the dead end docs/UI-CHECKLIST.md §3 names:
          a control a non-operator can see and click, that ends in a
          refusal rather than never being offered.
        -->
        <UTooltip text="Registration settings">
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-lucide-shield"
            square
            aria-label="Registration settings"
            to="/admin/registration"
          />
        </UTooltip>
        <!-- The only icon-only *button* in the chrome (the registration
             entry above is an icon-only link with the same contract).
             docs/UI-CHECKLIST.md §4.3 requires both an accessible name and
             a tooltip, because the same glyph is ambiguous across icon
             packs.
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
      <!-- The page gutter and the vertical rhythm are the shell's, not the
           screen's: 16px at compact and 24px from medium up are M3's layout
           margins (docs/DESIGN-SYSTEM.md §7.1), and `UContainer` already
           ships them plus the `mx-auto` that centres the region itself. -->
      <UContainer class="py-10 sm:py-16" :class="center ? 'my-auto' : undefined">
        <div :class="columnClass">
          <slot />
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

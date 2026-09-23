<script setup lang="ts">
/**
 * The page heading block: the optional eyebrow, the page's single `<h1>`,
 * and its supporting sentence — plus the rhythm between them and the
 * distance to whatever container follows.
 *
 * Every number here is docs/DESIGN-SYSTEM.md's, and every one of them had
 * drifted while the block existed in more than one file. Measured at
 * 1280x900 in both themes on 2026-09-07:
 *
 *   eyebrow → h1              8px   (4dp grid, one step inside the block)
 *   h1 → supporting sentence  12px  (`/` had 16px, this component 4px)
 *   block → container below   32px  (§7.4; `/` had 40px)
 *
 * 4px is M3's `supporting-text-top-space` — the tightest distance in the
 * whole field spec, and §7.4 already records using it in the wrong place
 * once (above a form label). Used under an `<h1>` it reads as a wrapped
 * second line of the heading rather than as a sentence about it.
 *
 * The supporting sentence is `body-large` — 16px on M3's 24px leading. It
 * is chrome, not document prose: §2.3's `doc-body` role (16px on 26px) is
 * the one deviation this project makes *for the reading surface*, and that
 * section says plainly that "chrome text keeps M3's 24px leading".
 *
 * An eyebrow must supply context the `<h1>` does not
 * (docs/UI-CHECKLIST.md §4.4) — a breadcrumb-shaped location ("Acme /
 * Handbook"), never a paraphrase of the heading beneath it. That was the
 * finding that removed the eyebrow from all four auth screens on
 * 2026-09-04.
 *
 * The block caps itself at `max-w-measure`. On `AppShell`'s `measure`
 * column that is a no-op, because the column is already that width — but a
 * heading block is prose, and on the shell's `wide` column the supporting
 * sentence would otherwise set solid across 1216px, roughly 150 characters
 * to the line against checklist §4.4's 65-80. docs/DESIGN-SYSTEM.md §2.4
 * is explicit that `--ui-container` is the shell's max width and never the
 * reading measure; capping here is what keeps that true on a screen that
 * needs the wide column for what sits *below* its heading.
 */
defineProps<{
  eyebrow?: string;
  heading: string;
  description?: string;
}>();

/**
 * The `<h1>`'s type role, bound rather than written twice: the block has
 * two shapes — with and without a control beside the heading — and a
 * heading whose role depended on which shape it took would be §4.4's
 * failure by another route.
 */
const HEADING_CLASS = 'text-headline-medium text-highlighted';
</script>

<template>
  <!--
    The default slot carries the heading's *content*, so a screen can put
    something editable where the text stands (`PageTitle`, 2026-09-23)
    without restating this block's rhythm. The `trailing` slot is for a
    control that acts on the heading, and it is a sibling of the `<h1>`
    rather than inside it, because anything inside a heading joins its
    accessible name. Both wrappers exist only when a screen fills the
    slot, so every screen that does not renders exactly the DOM it
    rendered before the slots existed.
  -->
  <div class="mb-8 max-w-measure">
    <p v-if="eyebrow" class="text-label-large text-muted">{{ eyebrow }}</p>
    <!-- `group/heading`: a control in the `trailing` slot may draw itself
         quiet and reveal on hover of the heading it acts on (§4.4), which
         is the comment gutter's own treatment and needs a named group to
         hang off. -->
    <div v-if="$slots.trailing" class="group/heading flex items-start gap-2" :class="eyebrow ? 'mt-2' : undefined">
      <h1 :class="[HEADING_CLASS, 'min-w-0 flex-1']">
        <slot>{{ heading }}</slot>
      </h1>
      <slot name="trailing" />
    </div>
    <h1 v-else :class="[HEADING_CLASS, eyebrow ? 'mt-2' : undefined]">
      <slot>{{ heading }}</slot>
    </h1>
    <slot name="under" />
    <p v-if="description" class="text-body-large text-muted mt-3">
      {{ description }}
    </p>
  </div>
</template>

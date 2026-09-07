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
 */
defineProps<{
  eyebrow?: string;
  heading: string;
  description?: string;
}>();
</script>

<template>
  <div class="mb-8">
    <p v-if="eyebrow" class="text-label-large text-muted">{{ eyebrow }}</p>
    <h1 class="text-headline-medium text-highlighted" :class="eyebrow ? 'mt-2' : undefined">
      {{ heading }}
    </h1>
    <p v-if="description" class="text-body-large text-muted mt-3">
      {{ description }}
    </p>
  </div>
</template>

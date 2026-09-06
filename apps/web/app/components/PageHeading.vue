<script setup lang="ts">
/**
 * The page heading block: the optional eyebrow, the page's single `<h1>`,
 * and its supporting sentence — plus the rhythm between them and the
 * distance to whatever container follows.
 *
 * Every number here is docs/DESIGN-SYSTEM.md's, and every one of them had
 * drifted while it lived in two files:
 *
 *   eyebrow → h1              8px   (4dp grid, one step inside the block)
 *   h1 → supporting sentence  12px  (`/` had 16px, the auth screens 12px)
 *   block → container below   32px  (§7.4; `/` had 40px, auth 32px)
 *
 * The supporting sentence is `body-large` — 16px on M3's 24px leading.
 * It is chrome, not document prose: §2.3's `doc-body` role (16px on 26px)
 * is the one deviation this project makes *for the reading surface*, and
 * that section says plainly that "chrome text keeps M3's 24px leading".
 * `/` was using the document role for a page description, which is why
 * the same sentence set solid differently on two screens.
 *
 * An eyebrow must supply context the `<h1>` does not (docs/UI-CHECKLIST.md
 * §4.4). Repeating a word of the heading spends a hierarchy level for
 * nothing — the finding that removed the eyebrow from all four auth
 * screens on 2026-09-04.
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

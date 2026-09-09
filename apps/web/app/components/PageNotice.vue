<script setup lang="ts">
/**
 * The container a screen shows *instead of* its content: permission
 * denied, not found, refused, someone else is editing, nothing here yet,
 * the request failed.
 *
 * It exists because those blocks were written eight times across the three
 * product screens as
 * `div.flex.items-start.gap-3.rounded-lg.bg-elevated.p-6` — a container
 * built by hand with its tone chosen by eye. Measured at 1280x900,
 * `bg-elevated` is `oklch(0.94828)` light / `oklch(0.28448)` dark, which
 * is *byte-identical to the header and the footer on the same screen*:
 * §1.4 gives that rung to chrome (the navigation pane, the contextual
 * panel, the top app bar), and `app.config.ts` gives it to `UHeader` and
 * `UFooter`. A content container drawn there reads as chrome. The auth
 * card, which is the nearest existing container, is one rung up at
 * `bg-emphasized` — `oklch(0.91379)` / `oklch(0.34483)`.
 *
 * So this is `UCard variant="soft"`, retargeted centrally to
 * `bg-emphasized`: the same component and the same tone as the auth card
 * (docs/DESIGN-SYSTEM.md §9.4 — a container sitting directly on the app
 * ground is M3's Filled card; docs/UI-CHECKLIST.md §4.1 — no hand-rolled
 * equivalent of a library primitive).
 *
 * `tone="error"` swaps the surface for M3's `error-container` role, which
 * is an accent container rather than a surface rung and therefore does not
 * move on the ladder. Colour is never the only signal (checklist §5): the
 * icon and the wording carry it, and the caller passes both.
 *
 * `level` picks the heading *element*, never its size. On read and edit
 * mode the notice replaces the page's content and so owns the page's only
 * `<h1>`; on the tree screen `PageHeading` already rendered one, so the
 * notice is an `<h2>`. The size follows §2.3's type scale from the level —
 * `h1` is `headline-medium` (28px) and `h2` is `headline-small` (24px) —
 * so a screen's `<h1>` keeps one type role across every state it has.
 * Before this component the denied, missing and refused states rendered
 * their `<h1>` at 24px while the same screen's success state rendered it
 * at 28px.
 */
const props = withDefaults(
  defineProps<{
    icon: string;
    heading: string;
    level?: 1 | 2;
    tone?: 'neutral' | 'error';
    /** `alert` for a failure the user did not ask for, `status` for a state they navigated into (checklist §3). */
    role?: 'status' | 'alert';
  }>(),
  { level: 1, tone: 'neutral', role: 'status' },
);

const headingTag = computed(() => (props.level === 1 ? 'h1' : 'h2'));
const headingClass = computed(() =>
  props.level === 1 ? 'text-headline-medium' : 'text-headline-small',
);
const isError = computed(() => props.tone === 'error');
</script>

<template>
  <UCard
    variant="soft"
    :role="role"
    :ui="{
      root: isError ? 'bg-error-container' : undefined,
      body: 'flex items-start gap-3',
    }"
  >
    <UIcon
      :name="icon"
      class="size-5 shrink-0"
      :class="isError ? 'text-on-error-container' : 'text-muted'"
      aria-hidden="true"
    />
    <div class="min-w-0">
      <component
        :is="headingTag"
        :class="[headingClass, isError ? 'text-on-error-container' : 'text-highlighted']"
      >
        {{ heading }}
      </component>
      <p class="text-body-medium mt-2" :class="isError ? 'text-on-error-container' : 'text-muted'">
        <slot />
      </p>
      <!-- 24px from the last line of copy to the actions, which is M3's
           dialog content-bottom (8) + actions-top (16) — the same distance
           §7.4 puts between a form's last field and its submit. -->
      <div v-if="$slots.actions" class="mt-6 flex flex-wrap gap-3">
        <slot name="actions" />
      </div>
    </div>
  </UCard>
</template>

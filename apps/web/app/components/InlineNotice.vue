<script setup lang="ts">
/**
 * The notice a screen shows *within* its flow — beside a form, above an
 * editor — as opposed to the one it shows *instead of* its content.
 *
 * ## The notice tiers, stated once
 *
 * This product has exactly three notice shapes. Anything that looks like a
 * fourth is one of these with the wrong classes (docs/UI-CHECKLIST.md §4.1:
 * anything on more than one screen is one component, never one copy per
 * screen — the 2026-09-14 audit counted five shapes across nineteen
 * hand-rolled copies before this file existed).
 *
 * | Tier      | Component                        | Job                                                                | Shape                                                           |
 * | --------- | -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
 * | **Panel** | `PageNotice`                     | Replaces a screen's content: denied, missing, locked, empty, failed | Filled card (§9.4), heading at the screen's level, icon, actions |
 * | **Bar**   | `InlineNotice` `tier="bar"`      | Stands in for, or beside, a form: a result, a dead link, a refusal | `rounded-md p-4`, icon, `body-large-emphasized` title, body, actions |
 * | **Chip**  | `InlineNotice` `tier="chip"`     | One line about the thing directly below it, with at most one action | `rounded-md px-3 py-2 text-body-small`, action on the same row  |
 *
 * A bar has a title because it is read on its own — the form it replaced
 * is gone. A chip has none because the thing it is about is still on
 * screen right under it.
 *
 * ## Tone
 *
 * The fill is M3's accent container pair (`<tone>-container` /
 * `on-<tone>-container`, §1.2): opaque, theme-safe, and legible by
 * construction (§10.1). Colour is never the only signal (checklist §5) —
 * a bar carries an icon and both tiers carry the wording; the caller
 * passes both.
 *
 * ## Announcement and focus
 *
 * `role` follows `PageNotice`'s rule: `status` for a state the user
 * navigated into, `alert` for a failure they did not ask for. `focus`
 * moves keyboard focus onto the notice when it mounts — for a result that
 * *replaces* the form the user just submitted, so focus does not fall off
 * the page (the audit measured `activeElement === BODY` after the
 * forgot-password submit) and the next Tab starts from the result. A chip
 * above a still-live editor must not take focus, so it stays opt-in.
 */
const props = withDefaults(
  defineProps<{
    tier: 'bar' | 'chip';
    tone: 'success' | 'error' | 'warning';
    /** Required on a bar (the non-colour signal beside the title); a chip's wording is its signal. */
    icon?: string;
    /** Bar only: the one-line result, `body-large-emphasized`. */
    title?: string;
    role?: 'status' | 'alert';
    /** Move focus here on mount — for a result that replaced the control the user was on. */
    focus?: boolean;
  }>(),
  { icon: undefined, title: undefined, role: 'status', focus: false },
);

const TONE_CLASS: Record<typeof props.tone, string> = {
  success: 'bg-success-container text-on-success-container',
  error: 'bg-error-container text-on-error-container',
  warning: 'bg-warning-container text-on-warning-container',
};

const root = ref<HTMLElement | null>(null);

onMounted(() => {
  if (props.focus) root.value?.focus();
});
</script>

<template>
  <!-- `tabindex="-1"` only when the notice is meant to take focus: a
       focusable notice with no reason is one extra tab stop for nothing.
       `outline-none` is NOT set — the global focus indicator (main.css §9)
       lands on it like on any control, which is how a keyboard user sees
       where they were sent. -->
  <div
    v-if="tier === 'bar'"
    ref="root"
    :data-notice-tier="tier"
    :role="role"
    :aria-live="role === 'status' ? 'polite' : undefined"
    :tabindex="focus ? -1 : undefined"
    class="flex items-start gap-3 rounded-md p-4"
    :class="TONE_CLASS[tone]"
  >
    <UIcon v-if="icon" :name="icon" class="size-5 shrink-0" aria-hidden="true" />
    <div class="min-w-0">
      <p v-if="title" class="text-body-large-emphasized">{{ title }}</p>
      <p v-if="$slots.default" class="text-body-medium" :class="title ? 'mt-1' : undefined">
        <slot />
      </p>
      <div v-if="$slots.actions" class="mt-3 flex flex-wrap gap-3">
        <slot name="actions" />
      </div>
    </div>
  </div>

  <div
    v-else
    ref="root"
    :data-notice-tier="tier"
    :role="role"
    :aria-live="role === 'status' ? 'polite' : undefined"
    :tabindex="focus ? -1 : undefined"
    class="flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 text-body-small"
    :class="TONE_CLASS[tone]"
  >
    <span><slot /></span>
    <slot name="actions" />
  </div>
</template>

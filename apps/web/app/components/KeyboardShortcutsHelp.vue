<script setup lang="ts">
/**
 * The `?` that names a surface's keys — a popover, not a dead button.
 *
 * ── What it replaces ──────────────────────────────────────────────────
 *
 * The navigation tree's `?` was a `UButton` inside a `UTooltip` with no
 * `@click` and no action: clicking it did nothing, which is what the owner
 * reported on 2026-09-23 and which docs/UI-CHECKLIST.md §6 counts as
 * observable breakage — "every control that looks clickable does
 * something". §5 still requires the keys to be *named in the UI*, so the
 * answer is to make it open something real rather than to make it stop
 * looking like a control.
 *
 * ── Why a popover ─────────────────────────────────────────────────────
 *
 * A tooltip is not a surface: it cannot be reached by a pointer without
 * hovering, it goes away the moment the pointer leaves, and a list of nine
 * chords in one is unreadable. `UPopover` is Reka-backed, so it brings the
 * focus trap, the focus return to the trigger, Escape and the
 * `aria-expanded`/`aria-controls` wiring that §5 requires and that a
 * hand-rolled disclosure would forfeit (§4.1). The trigger keeps its
 * tooltip *and* its accessible name, both halves of §4.3.
 *
 * ── Reusable on purpose ───────────────────────────────────────────────
 *
 * Edit mode names almost none of its bindings and was flagged for a
 * shortcut surface in the same review (docs/UI-CHECKLIST.md Review Log,
 * 2026-09-23). This component takes the list and nothing else, so that
 * surface is a list away; the list itself is recorded as owed in
 * docs/TODO.md rather than guessed here.
 *
 * ── The shapes ────────────────────────────────────────────────────────
 *
 * The content is the menu rung, `bg-accented` at `rounded-lg`, which is
 * where docs/DESIGN-SYSTEM.md §9.6 puts every popover; the heading is
 * `title-small` on `text-muted` (§2.3's navigation-drawer section
 * headline, the role the "Contents" label beside this control already
 * takes) and each line is `body-medium` (§9.8's dense-pane list label).
 * A `<dl>`, because the chord names the behaviour: the keys are the term
 * and the phrase is the definition, in that reading order, so no CSS
 * `order` reverses what a screen reader hears.
 */
import type { KeyboardShortcut } from '~/composables/useKeyboardShortcuts';

const props = withDefaults(
  defineProps<{
    /** What the surface answers, drawn and spoken — one list (`useKeyboardShortcuts`). */
    shortcuts: readonly KeyboardShortcut[];
    /** The control's accessible name and its tooltip: both, per §4.3. */
    label?: string;
    /** The popover's own heading — what these keys are the keys *of*. */
    heading: string;
  }>(),
  { label: 'Keyboard help' },
);
</script>

<template>
  <UPopover
    :content="{ align: 'end', collisionPadding: 8 }"
    :ui="{ content: 'bg-accented max-w-(--reka-popover-content-available-width)' }"
  >
    <UTooltip :text="props.label">
      <UButton
        icon="i-lucide-circle-help"
        variant="ghost"
        color="neutral"
        size="xs"
        square
        :aria-label="props.label"
        data-testid="keyboard-help-open"
      />
    </UTooltip>

    <template #content>
      <div class="w-72 max-w-full p-3">
        <p class="text-title-small text-muted">{{ props.heading }}</p>
        <dl class="mt-2 space-y-2">
          <div v-for="shortcut in props.shortcuts" :key="shortcut.spoken" class="flex items-baseline gap-3">
            <dt class="flex shrink-0 items-center gap-1">
              <UKbd v-for="key in shortcut.keys" :key="key" :value="key" />
            </dt>
            <dd class="min-w-0 text-body-medium text-default">{{ shortcut.description }}</dd>
          </div>
        </dl>
      </div>
    </template>
  </UPopover>
</template>

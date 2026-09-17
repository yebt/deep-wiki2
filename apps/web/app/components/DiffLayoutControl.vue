<script setup lang="ts">
/**
 * "Unified | Side by side" — the segmented control that chooses how an
 * edited block's two sides are laid out on a diff screen. One component
 * for both diff screens (docs/UI-CHECKLIST.md §4.1), rendered by
 * `DiffBlockChanges` so neither screen carries a copy.
 *
 * M3's segmented button (`docs/DESIGN-SYSTEM.md` §9.1's hierarchy, §5.2's
 * selected state): `UFieldGroup` — Nuxt UI 4's name for the button group;
 * an unknown tag renders its children on the client and nothing on the
 * server, which is how the control first shipped invisible until
 * hydration — an outlined group, the selected segment on the opaque
 * `secondary-container` pair — `UButton` `soft` `secondary`, the same
 * treatment the editor's selection toolbar gives a pressed control — and
 * `aria-pressed` beside it so the state is never colour alone (§5). Each
 * segment has an icon beside its visible label, never instead (§4.3),
 * and a tooltip; the side-by-side one states the fallback below `md`,
 * because at that width the choice is honoured as one column and the
 * control must not look inert.
 */
import type { DiffLayout } from '~/composables/useDiffLayout';

const props = defineProps<{ layout: DiffLayout }>();
const emit = defineEmits<{ change: [layout: DiffLayout] }>();

interface Segment {
  readonly value: DiffLayout;
  readonly label: string;
  readonly icon: string;
  readonly tooltip: string;
}

const SEGMENTS: readonly Segment[] = [
  { value: 'unified', label: 'Unified', icon: 'i-lucide-rows-3', tooltip: 'One column: deletions and insertions inline.' },
  {
    value: 'side-by-side',
    label: 'Side by side',
    icon: 'i-lucide-columns-2',
    tooltip: 'Two columns: before and after. Below 768px wide it falls back to one column.',
  },
];

function choose(value: DiffLayout): void {
  if (value !== props.layout) emit('change', value);
}
</script>

<template>
  <div role="group" aria-label="Diff layout">
    <UFieldGroup size="sm">
      <UTooltip v-for="segment in SEGMENTS" :key="segment.value" :text="segment.tooltip">
        <UButton
          :icon="segment.icon"
          :variant="segment.value === layout ? 'soft' : 'outline'"
          :color="segment.value === layout ? 'secondary' : 'neutral'"
          :aria-pressed="segment.value === layout ? 'true' : 'false'"
          @click="choose(segment.value)"
        >
          {{ segment.label }}
        </UButton>
      </UTooltip>
    </UFieldGroup>
  </div>
</template>

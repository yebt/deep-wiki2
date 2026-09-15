<script setup lang="ts">
/**
 * "Who is editing this page, and since when" (editing-presence spec;
 * docs/UI-CHECKLIST.md §4.8). Purely presentational — `usePresenceStream`
 * owns the roster, expiry and reconnect; this component only renders it.
 *
 * §4.8: "Presence avatars have accessible names; the presence row is not
 * conveyed by color alone." The initial bubble is decorative
 * (`aria-hidden`) because the sentence itself already names the editor —
 * text is the accessible name here, not the bubble — and the pencil icon
 * is the second, non-colour signal for "editing" alongside the
 * `primary-container` tint.
 *
 * §4.11 (Timestamps): "since when" is `formatRevisionDate` + `<time
 * datetime>`, the same rule and the same helper `history.vue` already
 * uses — the viewer's own zone, the zone named in the string, and the
 * exact instant preserved in the attribute. This never renders during
 * SSR: `editors` is only ever non-empty once a live presence event has
 * arrived, which cannot happen before this component is mounted client-
 * side, so there is no server/client zone mismatch to guard against here.
 */
import { formatRevisionDate } from '../utils/format-revision-date';
import { initials } from '../utils/initials';
import type { PresencePageEntry } from '../composables/usePresenceStream';

const props = defineProps<{ editors: readonly PresencePageEntry[] }>();

defineExpose({ formatRevisionDate });
</script>

<template>
  <div v-if="props.editors.length" class="flex items-center gap-2" role="status" data-testid="presence-indicator">
    <div
      v-for="editor in props.editors"
      :key="editor.userId"
      class="flex items-center gap-1 rounded-full bg-primary-container px-2 py-1 text-label-medium text-on-primary-container"
    >
      <span aria-hidden="true" class="flex size-5 items-center justify-center rounded-full bg-primary text-label-small text-on-primary">
        {{ initials(editor.userDisplayName) }}
      </span>
      <UIcon name="i-lucide-pencil" class="size-4" aria-hidden="true" />
      <span>{{ editor.userDisplayName }} is editing since <time :datetime="editor.since">{{ formatRevisionDate(editor.since) }}</time></span>
    </div>
  </div>
</template>

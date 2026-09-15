<script setup lang="ts">
/**
 * One column of the workspace dashboard: a titled region holding a list,
 * or — when there is nothing to list — a sentence that teaches what would
 * appear here and how to make it (docs/UI-CHECKLIST.md §3: empty states
 * name the object and offer a path forward, never "nothing here").
 *
 * An outlined card, the library default: inside a pane that already
 * carries a container tone, an elevated or filled card would be two
 * hierarchy signals for one level (docs/DESIGN-SYSTEM.md §9.4). The list
 * inside is the tenant's; the card only owns the title row and the empty
 * sentence, so four panels cannot drift into four headers.
 */
defineProps<{
  title: string;
  /** Present when the list has nothing in it: the empty sentence renders instead of the default slot. */
  empty: boolean;
}>();

const id = useId();
</script>

<template>
  <UCard as="section" variant="outline" :aria-labelledby="id" :ui="{ header: 'px-4 py-3 sm:px-4', body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <!-- `title-medium`: the role M3 gives a region's organising heading (§2.1). -->
        <h2 :id="id" class="text-title-medium text-highlighted">{{ title }}</h2>
        <slot name="meta" />
      </div>
    </template>
    <p v-if="empty" data-testid="panel-empty" class="px-4 py-6 text-body-medium text-muted">
      <slot name="empty" />
    </p>
    <slot v-else />
  </UCard>
</template>

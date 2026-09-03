<script setup lang="ts">
// Phase 0 smoke page: proof that apps/web boots, is themed, is
// accessible, and can reach apps/api — not a product screen. See
// docs/UI-CHECKLIST.md's scope note and design.md's Package Skeletons
// table ("web: one smoke page, one composable").
const { status, message, check } = useApiHealth();

onMounted(() => {
  void check();
});

const healthIcon = computed(() => {
  switch (status.value) {
    case 'ok':
      return 'i-lucide-circle-check';
    case 'error':
      return 'i-lucide-circle-x';
    case 'loading':
      return 'i-lucide-loader-circle';
    default:
      return 'i-lucide-circle-dashed';
  }
});

const healthColor = computed(() => {
  switch (status.value) {
    case 'ok':
      return 'success' as const;
    case 'error':
      return 'error' as const;
    default:
      return 'neutral' as const;
  }
});
</script>

<template>
  <div>
    <UHeader>
      <template #left>
        <span class="font-semibold text-highlighted">deep-wiki</span>
      </template>
      <template #right>
        <UColorModeButton aria-label="Toggle color theme" />
      </template>
    </UHeader>

    <UMain>
      <UContainer class="py-12">
        <UPageCard>
          <h1 class="text-2xl font-semibold text-highlighted">
            Bootstrap smoke page
          </h1>
          <p class="text-muted mt-2">
            This screen exists to prove the web application shell boots, is
            themed, and is reachable — it is not a product feature.
          </p>

          <div class="mt-6" role="status" aria-live="polite">
            <UBadge :color="healthColor" variant="subtle" :icon="healthIcon">
              {{ message }}
            </UBadge>
          </div>

          <UButton
            class="mt-4"
            icon="i-lucide-refresh-cw"
            variant="soft"
            :loading="status === 'loading'"
            @click="check"
          >
            Re-check API connection
          </UButton>
        </UPageCard>
      </UContainer>
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          deep-wiki bootstrap · Phase 0
        </p>
      </template>
    </UFooter>
  </div>
</template>

<script setup lang="ts">
// Phase 0 smoke page: proof that apps/web boots, is themed, is
// accessible, and can reach apps/api — not a product screen. See
// docs/UI-CHECKLIST.md's scope note and design.md's Package Skeletons
// table ("web: one smoke page, one composable").
//
// Every visual value here resolves to a token from
// apps/web/app/assets/css/main.css: the M3 type roles (`text-headline-*`,
// `text-title-*`, `text-body-*`, `text-label-*`), the surface-container
// ladder (`bg-muted` → `bg-default` / `bg-elevated`), the 4dp spacing
// grid and the shape scale. Hierarchy is carried by container tone, never
// by a shadow (docs/DESIGN-SYSTEM.md §1.3, §4.3).
const { status, message, detail, checkedAt, check } = useApiHealth();

const config = useRuntimeConfig();
const healthEndpoint = `${config.public.apiBaseUrl}/health`;

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

/**
 * The status indicator's container/on-container pair. An opaque M3
 * container token, never `bg-<color>/10` — alpha over an unknown
 * background is the defect docs/DESIGN-SYSTEM.md §12.8 names.
 */
const healthTone = computed(() => {
  switch (status.value) {
    case 'ok':
      return 'bg-success-container text-on-success-container';
    case 'error':
      return 'bg-error-container text-on-error-container';
    case 'loading':
      return 'bg-secondary-container text-on-secondary-container';
    default:
      return 'bg-elevated text-muted';
  }
});

const checkedAtLabel = computed(() =>
  checkedAt.value ? checkedAt.value.toLocaleTimeString() : null,
);

/**
 * What this page is actually evidence of. Not product content — each
 * entry names one of the four things the Phase 0 smoke page exists to
 * demonstrate, and each is verifiable on this screen.
 */
const proofs = [
  {
    icon: 'i-lucide-rocket',
    title: 'The shell boots',
    detail: 'Nuxt 4 renders this route on the server and hydrates it in the browser.',
  },
  {
    icon: 'i-lucide-palette',
    title: 'It is themed',
    detail: 'Every colour resolves to a Material Design 3 role. The toggle above switches both.',
  },
  {
    icon: 'i-lucide-accessibility',
    title: 'It is accessible',
    detail: 'Semantic landmarks, one h1, keyboard-operable controls, a visible focus ring.',
  },
  {
    icon: 'i-lucide-cable',
    title: 'It reaches the API',
    detail: 'The panel alongside pings apps/api over the network, from the browser.',
  },
] as const;
</script>

<template>
  <AppShell>
    <!-- The chrome is `AppShell`'s. This page carried its own copy until
         2026-09-07, and that copy was the one whose footer read "deep-wiki
         bootstrap · Phase 0" while the other two said "deep-wiki"
         (docs/UI-CHECKLIST.md §4.1). -->
    <UContainer class="py-10 sm:py-16">
      <div class="max-w-measure">
        <!-- The eyebrow is "Phase 0" and not "Phase 0 · Bootstrap": an
             eyebrow must add context the heading does not, and "Bootstrap"
             is already the first word of the `h1` under it (§4.4). The
             block, its 12px h1 → description gap and its 32px to the
             content below are `PageHeading`'s, which is what stopped this
             screen setting the same sentence solid differently from the
             auth screens — `doc-body`'s 16/26 is the reading surface's
             role, and a page description is chrome. -->
        <PageHeading
          eyebrow="Phase 0"
          heading="Bootstrap smoke page"
          description="This screen exists to prove the web application shell boots, is themed, and is reachable — it is not a product feature. Nothing here reads or writes a wiki; there is no navigation tree, no editor and no sign-in."
        />
      </div>

      <div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3 items-start">
          <UCard
            as="section"
            variant="soft"
            aria-labelledby="api-connection-heading"
            class="xl:col-span-2 min-w-0"
          >
            <h2
              id="api-connection-heading"
              class="text-title-large text-highlighted"
            >
              API connection
            </h2>
            <p class="text-body-medium text-muted mt-2">
              Checked from the browser on load, and again whenever you ask.
            </p>

            <div
              class="mt-6 flex items-start gap-3 rounded-md bg-default p-4"
              role="status"
              aria-live="polite"
            >
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full"
                :class="healthTone"
              >
                <UIcon
                  :name="healthIcon"
                  class="size-5"
                  :class="status === 'loading' && 'animate-spin'"
                  aria-hidden="true"
                />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-body-large-emphasized text-highlighted">
                  {{ message }}
                </p>
                <p
                  v-if="detail"
                  class="text-body-small text-muted mt-1 break-all"
                >
                  {{ detail }}
                </p>
                <p
                  v-if="checkedAtLabel"
                  class="text-label-medium text-muted mt-2"
                >
                  Last checked at {{ checkedAtLabel }}
                </p>
              </div>
            </div>

            <dl class="mt-6 border-t border-default">
              <div
                class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-default py-3"
              >
                <dt class="text-label-medium text-muted">Endpoint</dt>
                <dd class="text-body-medium text-default font-mono break-all">
                  {{ healthEndpoint }}
                </dd>
              </div>
              <div
                class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-default py-3"
              >
                <dt class="text-label-medium text-muted">Transport</dt>
                <dd class="text-body-medium text-default">
                  Browser fetch, no proxy
                </dd>
              </div>
            </dl>

            <UButton
              class="mt-6"
              icon="i-lucide-refresh-cw"
              variant="soft"
              color="primary"
              size="md"
              :loading="status === 'loading'"
              @click="check"
            >
              Re-check API connection
            </UButton>
          </UCard>

          <UCard as="section" aria-labelledby="proofs-heading" variant="soft" class="min-w-0">
            <h2 id="proofs-heading" class="text-title-large text-highlighted">
              What this page proves
            </h2>
            <ul class="mt-6 space-y-6">
              <li
                v-for="proof in proofs"
                :key="proof.title"
                class="flex items-start gap-3"
              >
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container"
                >
                  <UIcon :name="proof.icon" class="size-4" aria-hidden="true" />
                </span>
                <div class="min-w-0">
                  <p class="text-label-large-emphasized text-highlighted">
                    {{ proof.title }}
                  </p>
                  <p class="text-body-medium text-muted mt-1">
                    {{ proof.detail }}
                  </p>
                </div>
              </li>
            </ul>
          </UCard>
        </div>
      </UContainer>
  </AppShell>
</template>

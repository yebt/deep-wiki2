import { defineVitestConfig } from '@nuxt/test-utils/config';

// Scoped to apps/web only — the one workspace member where Vue SFCs and
// the Nuxt runtime (#app, #imports, #components) require Vitest instead
// of `bun test`. See design.md "The Deferred Decision: Vue SFC Tests" and
// scripts/checks/workspace-shape.ts, which asserts this stays confined to
// exactly one member.
export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    // Booting the Nuxt test environment (building the app once per worker)
    // regularly exceeds Vitest's 10s default hook timeout on a cold cache —
    // observed locally, not a hypothetical margin.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});

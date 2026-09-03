// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  typescript: {
    // Matches the strictness of the repository's shared tsconfig.base.json
    // (see apps/web/tsconfig.json for why this project does not extend it
    // directly).
    strict: true,
  },

  runtimeConfig: {
    public: {
      // apps/web reads zero required environment variables in Phase 0
      // (see src/config.ts). This is an optional, defaulted override —
      // not a fail-fast requirement — so it is not part of that schema.
      // Points at apps/api's default PORT from packages/contracts/src/env.ts.
      apiBaseUrl: 'http://localhost:4000',
    },
  },

  compatibilityDate: '2026-09-03',
})

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // `./modules/perf-prebundle` is dev-only and exists because a plain
  // `vite.optimizeDeps.include: ['reka-ui']` here is silently discarded:
  // `@nuxt/ui` transpiles `reka-ui` (node_modules/@nuxt/ui/dist/module.mjs:109),
  // `@nuxt/vite-builder` turns every transpile pattern into an
  // `optimizeDeps.exclude` entry for the client, and then drops any
  // `include` entry that is also excluded (dist/index.mjs:1115-1124). The
  // module hooks `vite:extendConfig` after both and moves the package from
  // `exclude` to `include`. Measured 2026-09-16: 1027 → 432 requests before
  // hydration on /pages/:id/edit in dev (docs/TODO.md Findings, "edit-mode
  // latency"). Nuxt scans `modules/` on its own; it is listed here so the
  // intent is visible from the config rather than from a directory
  // listing, and its `meta.name` keeps the two registrations one install.
  modules: ['@nuxt/eslint', '@nuxt/ui', './modules/perf-prebundle'],

  devtools: { enabled: true },

  devServer: {
    // Where apps/web listens in development, declared rather than left to
    // Nuxt's default. Two reasons, and both of them have already cost time:
    //
    //   1. `APP_URL` in .env must name this exact origin — it is the single
    //      origin apps/api allows through CORS *with credentials*. Name any
    //      other and the browser refuses the credentialed sign-in request
    //      before the page sees a response (`net::ERR_FAILED` in Chromium,
    //      `NS_ERROR_DOM_BAD_URI` in Firefox): no cookie is stored, and the
    //      form shows "Could not reach the server. Check your connection and
    //      try again." Loud, not silent — and misleading, which is worse: the
    //      screen blames the connection, the connection is fine, and neither
    //      server logs anything about CORS (measured 2026-09-09; this comment
    //      claimed a silent 200 until then). It shipped pointing at 4173,
    //      which no dev server ever listened on. `bun run env:check` now reads
    //      the number below and compares them, so the two cannot drift again.
    //   2. Nuxt's default is 3000, which is also `PORT` — where apps/api
    //      listens. Whichever started second was quietly moved to 3001 by the
    //      dev server's own fallback, so the web origin depended on start
    //      order. 3001 is that fallback, made deterministic.
    port: 3001,
  },

  css: ['~/assets/css/main.css'],

  icon: {
    // Self-hosted product: air-gapped instances must not depend on the
    // Iconify HTTP API. `@iconify-json/lucide` is installed as a dev
    // dependency and explicitly bundled into the server output so every
    // `i-lucide-*` icon this app or Nuxt UI's defaults use is served from
    // the local bundle. See docs/UI-CHECKLIST.md §4.3's build gotcha.
    serverBundle: {
      collections: ['lucide'],
    },
  },

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
      //
      // Override with NUXT_PUBLIC_API_BASE_URL, which Nuxt maps onto this key
      // automatically. The default must track `PORT` in env.example: this is
      // the same fact written in two places, and `bun run env:check` compares
      // them because they silently drifted once already.
      apiBaseUrl: 'http://localhost:3000',
    },
  },

  compatibilityDate: '2026-09-03',
})

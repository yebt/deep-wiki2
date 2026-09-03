// @ts-check
// Generated at `nuxt prepare` time (wired as this package's postinstall
// script) from the `@nuxt/eslint` module registered in nuxt.config.ts.
// It composes typescript-eslint + eslint-plugin-vue with Nuxt's own
// auto-import globals resolved, which the repository's shared
// eslint.config.js cannot express — see that file's ignore list, which
// deliberately excludes this package so `bun run lint` at the root never
// re-lints these files against the plain TypeScript ruleset.
import withNuxt from './.nuxt/eslint.config.mjs';

export default withNuxt();

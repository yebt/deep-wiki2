/**
 * Dev-only: serve `reka-ui` as one prebundled chunk instead of ~565 raw
 * ESM files.
 *
 * Measured on 2026-09-16 (docs/TODO.md Findings, "edit-mode latency"):
 * a dev-mode load of `/pages/:id/edit` made 1027–1033 requests before
 * hydration, 565 of them `reka-ui` modules served one by one over
 * HTTP/1.1 and spanning 0.78 s → 3.04 s of the load on their own. The
 * cause is three lines in two other packages, and each one is right on
 * its own:
 *
 *   1. `@nuxt/ui` marks its headless layer for transpilation —
 *      `nuxt.options.build.transpile.push("reka-ui")`
 *      (node_modules/@nuxt/ui/dist/module.mjs:109).
 *   2. `@nuxt/vite-builder` turns every string transpile pattern into a
 *      Vite `optimizeDeps.exclude` entry for the client environment
 *      (dist/index.mjs, `clientEnvironment` spreading
 *      `getTranspileStrings(...)` into `exclude`), so Vite's dependency
 *      optimizer never touches it.
 *   3. The builder's `nuxt:dev-server` plugin then drops any
 *      `optimizeDeps.include` entry that is also excluded
 *      (dist/index.mjs:1115-1124: `item.include = item.include?.filter(
 *      (dep) => !exclude.has(dep))`).
 *
 * So the obvious `vite: { optimizeDeps: { include: ['reka-ui'] } }` in
 * nuxt.config.ts is silently discarded. This module runs after both: it
 * hooks `vite:extendConfig`, and on the client config only, removes
 * `reka-ui` from `exclude` and adds it to `include`, so step 3 keeps it.
 * Vite then prebundles the package once into its cache (6 MB, immutable,
 * cached by the browser after the first load) and serves it as a single
 * request. Measured in a worktree: 1027 → 432 requests before hydration;
 * `reka-ui` 565 → 2. No HMR or runtime difference on any screen driven
 * in the e2e suite; `e2e/perf.spec.ts` holds the request count.
 *
 * Both config shapes the builder hands out are rewritten: the legacy
 * top-level `config.optimizeDeps` (what Nuxt 4 with
 * `compatibilityVersion: 4` produces) and the Vite environment-API shape
 * `config.environments.client.optimizeDeps` (what `experimental.
 * viteEnvironmentApi` produces), so a future flip of that flag does not
 * silently reopen the waterfall.
 *
 * `optimizeDeps` is a dev-server concept — a production build goes
 * through Rollup and bundles everything regardless — so the hook is only
 * installed in dev.
 */
import { defineNuxtModule } from '@nuxt/kit';
import type { Nuxt } from '@nuxt/schema';

/** What gets moved from `optimizeDeps.exclude` to `optimizeDeps.include`. */
export const PREBUNDLED_DEPENDENCIES: readonly string[] = ['reka-ui'];

export interface OptimizeDepsLike {
  include?: string[];
  exclude?: string[];
}

/** Pure: `deps` leave `exclude` and join `include`, once each. */
export function prebundle(optimizeDeps: OptimizeDepsLike | undefined, deps: readonly string[]): OptimizeDepsLike {
  const wanted = new Set(deps);
  const exclude = (optimizeDeps?.exclude ?? []).filter((dep) => !wanted.has(dep));
  const include = [...(optimizeDeps?.include ?? [])];
  for (const dep of deps) {
    if (!include.includes(dep)) include.push(dep);
  }
  return { ...optimizeDeps, include, exclude };
}

interface ViteConfigLike {
  optimizeDeps?: OptimizeDepsLike;
  environments?: { client?: { optimizeDeps?: OptimizeDepsLike } };
}

/** The module's whole behaviour, separated from `defineNuxtModule` so a test can drive it with a fake `nuxt`. */
export function registerPrebundle(nuxt: Nuxt): void {
  if (!nuxt.options.dev) return;
  nuxt.hook('vite:extendConfig', (config, { isClient }) => {
    if (!isClient) return;
    const target = config as ViteConfigLike;
    if (target.optimizeDeps || !target.environments?.client) {
      target.optimizeDeps = prebundle(target.optimizeDeps, PREBUNDLED_DEPENDENCIES);
    }
    const client = target.environments?.client;
    if (client) client.optimizeDeps = prebundle(client.optimizeDeps, PREBUNDLED_DEPENDENCIES);
  });
}

export default defineNuxtModule({
  // The name is what deduplicates this module: Nuxt scans `modules/`
  // AND nuxt.config.ts lists it, and `defineNuxtModule` installs a named
  // module once (`nuxt.options._requiredModules`).
  meta: { name: 'deep-wiki:perf-prebundle' },
  setup(_options, nuxt) {
    registerPrebundle(nuxt);
  },
});

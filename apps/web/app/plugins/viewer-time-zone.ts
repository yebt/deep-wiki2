import { markHydrated, markHydrating } from '~/composables/useViewerTimeZone';

/**
 * Keeps `viewerTimeZone()` honest on the client: a server-rendered
 * document is hydrated in UTC, exactly as the server formatted it, and
 * switches to the viewer's zone when hydration resolves. See
 * `useViewerTimeZone.ts`. Exported as a named function so the test can
 * drive it with a fake app.
 */
export function installViewerTimeZone(nuxtApp: { payload: { serverRendered?: boolean }; hook: (name: 'app:suspense:resolve', fn: () => void) => unknown }): void {
  if (!import.meta.client || !nuxtApp.payload.serverRendered) return;
  markHydrating();
  nuxtApp.hook('app:suspense:resolve', markHydrated);
}

export default defineNuxtPlugin((nuxtApp) => {
  installViewerTimeZone(nuxtApp as unknown as Parameters<typeof installViewerTimeZone>[0]);
});

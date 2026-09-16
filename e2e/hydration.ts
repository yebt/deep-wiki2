import type { Page } from '@playwright/test';

/**
 * Waits until the app has hydrated the server-rendered document.
 *
 * Since the read layer (`apps/web/app/composables/useApiRead.ts`), a
 * screen's content is in the HTML the server sends, and it is on screen
 * long before the client bundle has loaded and hydrated it — in dev mode
 * under load, tens of seconds before. A test that asserts the content and
 * then presses a key, expects a tooltip, or counts on a client-side
 * navigation is racing hydration: before it, a link is a plain link (a
 * full load, not a hop), focus opens no tooltip, and nothing listens.
 * Until the read layer, the content itself was fetched after hydration,
 * so its appearance was the signal; this is that signal made explicit.
 *
 * Vue sets `__vue_app__` on the root container when the app mounts, and
 * Nuxt mounts after every client plugin has run — the point from which
 * the page's components answer events.
 */
export async function waitForHydration(page: Page, timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    () => Boolean((document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null)?.__vue_app__),
    undefined,
    { timeout },
  );
}

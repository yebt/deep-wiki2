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
 * Two conditions, because the first alone is not enough. Vue sets
 * `__vue_app__` on the root container when the app mounts — but Nuxt
 * mounts its tree inside `<Suspense>`, and a screen whose setup is
 * asynchronous (every screen on the read layer) is hydrated only once
 * that suspense resolves, a frame to a second later. In between, the
 * app is "mounted" and the frame's drawer toggle still has no listener:
 * `e2e/management.spec.ts` clicked "Open sidebar" in that window on
 * 2026-09-16 and nothing opened. Nuxt marks the resolution itself —
 * `isHydrating` turns `false` as `app:suspense:resolve` fires — so that
 * is the second condition.
 */
export async function waitForHydration(page: Page, timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#__nuxt') as (Element & { __vue_app__?: { config: { globalProperties: { $nuxt?: { isHydrating: boolean } } } } }) | null;
      const nuxt = root?.__vue_app__?.config.globalProperties.$nuxt;
      return Boolean(nuxt) && nuxt!.isHydrating === false;
    },
    undefined,
    { timeout },
  );
}

/**
 * A promise that resolves once the browser has been answered for this
 * page's comment threads (`GET /pages/:id/comments`).
 *
 * **A hydration wait is not a fetch wait.** `waitForHydration` says the
 * client has taken the server's document over; it says nothing about the
 * requests the hydrated app then makes. The comment overlay is drawn from
 * one of them — `usePageComments`' single `GET /pages/:id/comments`, which
 * carries both the threads and `canComment` — so "no mark" and "no toggle"
 * asserted between hydration and that response are still absences of
 * something the client has not had the chance to draw. Where a screen
 * offers a positive the fetch must have produced (the "Show comments"
 * toggle with its count, the orphaned or unplaced chip), assert that
 * instead; this is for the screens whose whole claim is that the overlay
 * draws *nothing*, where there is no such positive to wait for
 * (docs/TODO.md Findings, 2026-09-23).
 *
 * Call it **before** `goto`: `page.waitForResponse` only sees responses
 * that arrive after it is registered, and on a warm route the answer can
 * land before the next line runs.
 */
export function pageCommentsAnswered(page: Page, timeout = 120_000): Promise<unknown> {
  return page.waitForResponse(
    (response) => response.request().method() === 'GET' && /\/pages\/[^/]+\/comments(?:$|\?)/.test(response.url()),
    { timeout },
  );
}

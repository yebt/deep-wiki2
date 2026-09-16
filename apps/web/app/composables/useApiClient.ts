/** The options `$fetch.create` takes, named without a direct dependency on ofetch — Nuxt's `$fetch` is the one this app has. */
type ApiRequestOptions = Parameters<typeof $fetch.create>[0];
type ApiClient = ReturnType<typeof $fetch.create>;

/**
 * The defaults every API request is built with: the configured API origin
 * and the browser's credentials. On the server, the session cookie of the
 * request being rendered is forwarded as well — apps/api authenticates by
 * that cookie alone (`apps/api/src/middleware/session.ts`), and the Nuxt
 * server is a different client from the browser, with no cookie jar of
 * its own. `useRequestHeaders` is empty in the browser, where the browser
 * attaches the cookie itself.
 */
export function apiRequestOptions(): ApiRequestOptions {
  const config = useRuntimeConfig();
  const options: ApiRequestOptions = { baseURL: config.public.apiBaseUrl, credentials: 'include' };
  if (import.meta.server) {
    const { cookie } = useRequestHeaders(['cookie']);
    if (cookie) options.headers = { cookie };
  }
  return options;
}

/**
 * `$fetch` bound to the API: `api('/pages/…')` where a composable used to
 * spell `$fetch(`${config.public.apiBaseUrl}/pages/…`, { credentials:
 * 'include' })`. Read composables build their default fetcher on this so
 * the same request works from a server render (`useApiRead`) and from the
 * browser; the injectable fetcher each of them accepts stays the seam for
 * tests.
 */
export function useApiClient(): ApiClient {
  return $fetch.create(apiRequestOptions());
}

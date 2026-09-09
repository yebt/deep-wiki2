/**
 * The one place in apps/web that reads the error `$fetch`/ofetch throws.
 *
 * ── Why this is centralised ────────────────────────────────────────────
 *
 * Every composable that talks to the API has to answer the same two
 * questions in its `catch`: did a response come back at all, and if so
 * with what status? That is one fact about one library, and it was
 * written out by hand ten times in `app/composables/` — in four different
 * spellings, four of which were wrong. The wrong ones tested only for the
 * *presence* of the key:
 *
 *     typeof error === 'object' && error !== null && 'response' in error
 *
 * ofetch **always defines** `response` on its error object, setting it to
 * `undefined` when the request never got a reply (connection refused, DNS
 * failure, the API simply not running). `'response' in error` is
 * therefore `true` even then, and the next line — `error.response.status`
 * — throws `Cannot read properties of undefined` *inside the catch block*,
 * before any status has been assigned. The composable's status ref never
 * left `'loading'`, so the screen sat on its `aria-hidden` skeleton with
 * no list, no error notice and no way forward. Reported as "no me carga
 * nada"; it was every screen at once, because four composables shared the
 * mistake.
 *
 * The key presence is not the question. Whether a response *arrived* is.
 *
 * `app/utils/fetch-error.test.ts` both pins that behaviour and fails the
 * build if an eleventh hand-written copy of this guard appears anywhere
 * under `app/` — the divergence, not just the bug, is what made one
 * library quirk into four broken screens.
 */

/**
 * Shape of the error ofetch/`$fetch` throws. `response` is an own property
 * whichever way the request ended: the `Response` when the server replied
 * with a non-2xx status, `undefined` when nothing ever came back. `data`
 * carries the parsed error body when there was one.
 */
interface FetchError {
  readonly response?: { readonly status?: number };
  readonly data?: unknown;
}

/**
 * Did the request reach the server and come back with a response?
 *
 * `false` means the failure is a network one — nothing to classify by
 * status, and the user's next action is "check the connection and retry",
 * not "sign in" or "you don't have access".
 */
export function serverResponded(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    (error as FetchError).response !== undefined
  );
}

/**
 * The HTTP status the server replied with, or `undefined` when no response
 * ever arrived. Callers branch on the status they know how to handle and
 * treat `undefined` — along with any status they have no state for — as a
 * recoverable network error.
 */
export function httpStatusOf(error: unknown): number | undefined {
  if (!serverResponded(error)) {
    return undefined;
  }
  const status = (error as FetchError).response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The parsed error body ofetch attaches to a non-2xx response, or
 * `undefined` when no response arrived. Deliberately `unknown`: the shape
 * differs per endpoint, so the calling composable — which knows which
 * endpoint it asked — is the one that narrows it.
 */
export function responseBodyOf(error: unknown): unknown {
  return serverResponded(error) ? (error as FetchError).data : undefined;
}

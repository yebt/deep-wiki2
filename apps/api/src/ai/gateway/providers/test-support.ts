/**
 * Shared fixture-replay helpers for the provider adapter test suites
 * (design.md — "Testing strategy" — "Provider adapters"). Not a test
 * file itself: no `expect(`/`assert(` lives here, only plumbing.
 */

export function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

export function textEventStreamFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
}

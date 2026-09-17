/**
 * The budget guard for `bun run test` (docs/TODO.md Finding 2026-09-17 —
 * "Cheap models first"). Preloaded by `apps/api/bunfig.toml` under
 * `bun test`, it replaces the global `fetch` with one that refuses any
 * host that is not loopback. Every provider adapter and probe takes an
 * injected `fetch` and every suite passes a fixture one
 * (`src/ai/gateway/providers/test-support.ts`); this is what turns that
 * convention into a rule. A test that forgets its fixture fails at the
 * call with the fix in the message, instead of spending money and
 * passing. The local harness services (Mailpit, MinIO) are on
 * `localhost` and pass through untouched.
 *
 * The opt-in CLIs (`ai:probe`, `ai:conformance`, `ai:catalogue`) are the
 * only sanctioned network path and are never run under this preload —
 * their tests spawn them as separate processes with an environment of
 * exactly `PATH` and `HOME`, so no key can reach them there either.
 */

export const NETWORK_GUARD_MESSAGE = 'bun test reached for the network';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

function hostnameOf(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.hostname;
  if (typeof input === 'string') return new URL(input).hostname;
  return new URL(input.url).hostname;
}

/** Wraps `inner` so a non-loopback host is refused before `inner` sees it; `inner`'s own properties survive. */
export function guardFetch(inner: typeof fetch): typeof fetch {
  const guarded = ((input: RequestInfo | URL, init?: RequestInit) => {
    const hostname = hostnameOf(input);
    if (!LOOPBACK_HOSTS.has(hostname)) {
      return Promise.reject(
        new TypeError(
          `${NETWORK_GUARD_MESSAGE}: ${hostname} — inject a fixture fetch (src/ai/gateway/providers/test-support.ts) or run the opt-in CLI outside bun test`,
        ),
      );
    }
    return inner(input, init);
  }) as typeof fetch;
  return Object.assign(guarded, inner);
}

globalThis.fetch = guardFetch(globalThis.fetch);

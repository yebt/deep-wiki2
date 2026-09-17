/**
 * The budget guard (docs/TODO.md Finding 2026-09-17 — "Cheap models
 * first"): nothing in `bun run test` may reach a provider. Two halves —
 * the wrapper's own rule, exercised with a fake inner fetch, and the
 * proof that `apps/api/bunfig.toml` actually preloaded it into this very
 * process: the real global `fetch` refuses a provider host.
 */
import { describe, expect, test } from 'bun:test';
import { guardFetch, NETWORK_GUARD_MESSAGE } from './no-network';

function recordingFetch(): { calls: string[]; fetch: typeof fetch } {
  const calls: string[] = [];
  const fake = (async (input: RequestInfo | URL) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response('ok');
  }) as unknown as typeof fetch;
  return { calls, fetch: fake };
}

describe('guardFetch', () => {
  test('lets a loopback URL through to the inner fetch, in every spelling', async () => {
    const inner = recordingFetch();
    const guarded = guardFetch(inner.fetch);

    await guarded('http://localhost:8025/api/v1/messages');
    await guarded(new URL('http://127.0.0.1:9000/minio/health/live'));
    await guarded(new Request('http://[::1]:3000/'));

    expect(inner.calls).toHaveLength(3);
  });

  test('refuses a provider host before the inner fetch sees it, naming the fix', async () => {
    const inner = recordingFetch();
    const guarded = guardFetch(inner.fetch);

    await expect(guarded('https://openrouter.ai/api/v1/chat/completions')).rejects.toThrow(NETWORK_GUARD_MESSAGE);
    await expect(guarded(new Request('https://api.openai.com/v1/embeddings'))).rejects.toThrow('api.openai.com');

    expect(inner.calls).toHaveLength(0);
  });

  test('keeps the inner fetch\'s own properties (Bun\'s `fetch.preconnect`)', () => {
    const inner = Object.assign((async () => new Response('ok')) as unknown as typeof fetch, { preconnect: () => {} });

    const guarded = guardFetch(inner);

    expect(typeof (guarded as unknown as { preconnect: unknown }).preconnect).toBe('function');
  });
});

describe('the preload is active under `bun test` in apps/api', () => {
  test('the global fetch refuses a provider host', async () => {
    await expect(fetch('https://openrouter.ai/api/v1/models')).rejects.toThrow(NETWORK_GUARD_MESSAGE);
  });
});

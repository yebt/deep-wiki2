/**
 * `probe.ts` — the blocking verification `ai:probe` runs (proposal —
 * "Escalated Open Question"; design.md — "Drift detection", "Live
 * conformance"). Deterministic behaviour (fixture parsing, HTTP-status
 * mapping) is proven here with an injected `fetch`; the opt-in
 * `ai:probe` CLI is what actually calls a live provider with a real key
 * — this suite never touches a network, per `bun run test`'s own rule.
 */
import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import googleEmbedFixture from './gateway/providers/__fixtures__/google-embed.json';
import openaiEmbedFixture from './gateway/providers/__fixtures__/openai-embed.json';
import { jsonFetch } from './gateway/providers/test-support';
import { probeGoogleEmbeddings, probeOpenAiEmbeddings, probeOpenRouterEmbeddings } from './probe';

describe('probeOpenAiEmbeddings', () => {
  test('a successful embeddings response reports supported with the observed dimension', async () => {
    const outcome = await probeOpenAiEmbeddings(new Secret('sk-fake'), jsonFetch(200, openaiEmbedFixture));

    expect(outcome).toEqual({ provider: 'openai', supported: true, detail: 'embedding dimensions observed: 4' });
  });

  test('an HTTP 404 reports unsupported, never the raw provider payload', async () => {
    const outcome = await probeOpenAiEmbeddings(new Secret('sk-fake'), jsonFetch(404, { error: { message: 'not found' } }));

    expect(outcome.provider).toBe('openai');
    expect(outcome.supported).toBe(false);
    expect(outcome.detail.includes('not found')).toBe(false);
  });
});

describe('probeGoogleEmbeddings', () => {
  test('a successful embeddings response reports supported with the observed dimension', async () => {
    const outcome = await probeGoogleEmbeddings(new Secret('sk-fake'), jsonFetch(200, googleEmbedFixture));

    expect(outcome).toEqual({ provider: 'google', supported: true, detail: 'embedding dimensions observed: 4' });
  });

  test('an HTTP 401 reports unsupported, never the raw provider payload', async () => {
    const outcome = await probeGoogleEmbeddings(new Secret('sk-fake'), jsonFetch(401, { error: { message: 'invalid api key value here' } }));

    expect(outcome.provider).toBe('google');
    expect(outcome.supported).toBe(false);
    expect(outcome.detail.includes('invalid api key value here')).toBe(false);
  });
});

describe('probeOpenRouterEmbeddings — no EmbeddingModelPort adapter exists, so this hits the documented REST shape directly', () => {
  test('HTTP 404 is read as "no embeddings endpoint"', async () => {
    const outcome = await probeOpenRouterEmbeddings(new Secret('sk-fake'), jsonFetch(404, { error: 'not found' }));

    expect(outcome).toEqual({ provider: 'openrouter', supported: false, detail: 'HTTP 404 — no embeddings endpoint' });
  });

  test('HTTP 200 is read as supported, reporting the observed dimension like the OpenAI probe does', async () => {
    const outcome = await probeOpenRouterEmbeddings(new Secret('sk-fake'), jsonFetch(200, { data: [{ embedding: [0.1, 0.2] }] }));

    expect(outcome).toEqual({ provider: 'openrouter', supported: true, detail: 'HTTP 200 — embedding dimensions observed: 2' });
  });

  test('HTTP 200 with a body that is not an embeddings list is still supported, with the dimension unknown', async () => {
    const outcome = await probeOpenRouterEmbeddings(new Secret('sk-fake'), jsonFetch(200, { unexpected: true }));

    expect(outcome).toEqual({ provider: 'openrouter', supported: true, detail: 'HTTP 200 — embedding dimensions observed: unknown' });
  });

  test('a transport failure reports unsupported rather than throwing', async () => {
    const throwingFetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const outcome = await probeOpenRouterEmbeddings(new Secret('sk-fake'), throwingFetch);

    expect(outcome).toEqual({ provider: 'openrouter', supported: false, detail: 'network error' });
  });
});

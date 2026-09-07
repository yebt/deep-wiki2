/**
 * The real `CredentialValidationProbe` (workspace-ai-credentials spec —
 * "Validation Probe on Save"; design.md — "the real implementation lives
 * with the Vercel AI SDK adapters"). Runs the cheapest call this module
 * can make — a one-token `generate()` against the registry's own default
 * model for the provider — and maps the normalized `ProviderError` code
 * (`./providers/errors.ts`) to the closed `ProbeErrorCode` set, never
 * echoing the provider's own error payload (no key-shaped substring may
 * reach a caller or a logger).
 */
import { describe, expect, test } from 'bun:test';
import { Secret } from '@deep-wiki/core';
import error401Fixture from './providers/__fixtures__/anthropic-error-401.json';
import error429Fixture from './providers/__fixtures__/anthropic-error-429.json';
import generateFixture from './providers/__fixtures__/anthropic-generate.json';
import { jsonFetch } from './providers/test-support';
import { createVercelAiValidationProbe } from './validation-probe';

describe('createVercelAiValidationProbe', () => {
  test('a provider-accepted key probes ok', async () => {
    const probe = createVercelAiValidationProbe(jsonFetch(200, generateFixture));

    const result = await probe.probe('anthropic', new Secret('sk-ant-real'));

    expect(result.ok).toBe(true);
  });

  test('an HTTP 401 maps to invalid_key, never echoing the provider payload', async () => {
    const probe = createVercelAiValidationProbe(jsonFetch(401, error401Fixture));

    const result = await probe.probe('anthropic', new Secret('sk-ant-bad'));

    expect(result).toEqual({ ok: false, errorCode: 'invalid_key' });
  });

  test('an HTTP 429 maps to insufficient_quota', async () => {
    const probe = createVercelAiValidationProbe(jsonFetch(429, error429Fixture));

    const result = await probe.probe('anthropic', new Secret('sk-ant-throttled'));

    expect(result).toEqual({ ok: false, errorCode: 'insufficient_quota' });
  });

  test('a transport failure maps to network', async () => {
    const throwingFetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const probe = createVercelAiValidationProbe(throwingFetch);

    const result = await probe.probe('anthropic', new Secret('sk-ant-anything'));

    expect(result).toEqual({ ok: false, errorCode: 'network' });
  });

  test('the local provider has no SDK-backed probe and is refused rather than optimistically "ok"', async () => {
    const probe = createVercelAiValidationProbe(jsonFetch(200, generateFixture));

    const result = await probe.probe('local', new Secret('irrelevant'));

    expect(result).toEqual({ ok: false, errorCode: 'unknown' });
  });
});

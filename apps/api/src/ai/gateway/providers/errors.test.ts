/**
 * The one error mapping every adapter shares (design.md — "Normalized
 * Provider Errors"). The status codes are the contract; the messages
 * are held to never echo what the provider sent back, because a
 * provider's own payload routinely carries an echoed fragment of the
 * request — the credential included.
 */
import { describe, expect, test } from 'bun:test';
import { APICallError } from 'ai';
import { mapProviderError } from './errors';

const LEAKY_BODY = '{"error":"invalid x-api-key sk-live-leaked-1234"}';

function apiError(statusCode: number | undefined): APICallError {
  return new APICallError({
    message: `provider said: ${LEAKY_BODY}`,
    url: 'https://provider.example/v1/messages',
    requestBodyValues: { apiKey: 'sk-live-leaked-1234' },
    statusCode,
    responseBody: LEAKY_BODY,
  });
}

describe('mapProviderError', () => {
  test('429 is a rate limit', () => {
    expect(mapProviderError(apiError(429)).code).toBe('rate-limit');
  });

  test('401 and 403 are both an auth failure', () => {
    expect(mapProviderError(apiError(401)).code).toBe('auth');
    expect(mapProviderError(apiError(403)).code).toBe('auth');
  });

  test('any other HTTP status is unknown and names the status, not the body', () => {
    const mapped = mapProviderError(apiError(500));

    expect(mapped.code).toBe('unknown');
    expect(mapped.message).toContain('500');
  });

  test('an APICallError with no status code still maps to unknown', () => {
    expect(mapProviderError(apiError(undefined)).code).toBe('unknown');
  });

  test('anything that is not an APICallError is a network failure', () => {
    expect(mapProviderError(new TypeError('fetch failed')).code).toBe('network');
    expect(mapProviderError('a string').code).toBe('network');
    expect(mapProviderError(undefined).code).toBe('network');
  });

  test('no mapped message ever echoes the provider payload or the request', () => {
    for (const status of [401, 403, 429, 500, undefined]) {
      const mapped = mapProviderError(apiError(status));

      expect(mapped.message).not.toContain('sk-live-leaked-1234');
      expect(mapped.message).not.toContain(LEAKY_BODY);
      expect(mapped.message).not.toContain('provider said');
    }
  });
});

import { describe, expect, test } from 'vitest';
import { useRuntimeConfig } from '#imports';
import { apiRequestOptions, useApiClient } from './useApiClient';

/**
 * Every read composable's default transport. What a unit test can hold
 * without a network: the defaults every request is built with. The
 * server-side half — the session cookie forwarded from the request being
 * rendered — is proven by `e2e/data-layer.spec.ts`, which reads the
 * article out of the server-rendered document.
 */
describe('apiRequestOptions', () => {
  test('targets the configured API origin with credentials', () => {
    const options = apiRequestOptions();

    expect(options.baseURL).toBe(useRuntimeConfig().public.apiBaseUrl);
    expect(options.credentials).toBe('include');
  });

  test('forwards no cookie header in the browser: the browser attaches its own', () => {
    expect(apiRequestOptions().headers).toBeUndefined();
  });
});

describe('useApiClient', () => {
  test('is a fetch function bound to those defaults', () => {
    const api = useApiClient();

    expect(typeof api).toBe('function');
  });
});

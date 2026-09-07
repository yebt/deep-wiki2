/**
 * Shared normalized-error mapping for every provider adapter in this
 * directory (design.md — "Normalized Provider Errors"; ai-provider-registry
 * spec). `APICallError` is the Vercel AI SDK's own closed error shape for
 * an HTTP-level provider failure; anything else (a thrown `TypeError` from
 * a failed `fetch`, a DNS error, an aborted connection) is a transport
 * failure, mapped to `network`.
 *
 * The mapped message NEVER echoes `error.message` or `error.responseBody`
 * — a provider's own error payload routinely carries request headers or
 * an echoed fragment of the request body, and neither may reach a logger
 * (workspace-ai-credentials spec — "Validation failure does not leak the
 * key"; ai-provider-registry spec — "Invalid credential").
 */
import { APICallError } from 'ai';
import type { ProviderError } from '@deep-wiki/core';

export function mapProviderError(caught: unknown): ProviderError {
  if (APICallError.isInstance(caught)) {
    if (caught.statusCode === 429) {
      return { code: 'rate-limit', message: 'the provider reported a rate limit' };
    }
    if (caught.statusCode === 401 || caught.statusCode === 403) {
      return { code: 'auth', message: 'the provider rejected the credential' };
    }
    return { code: 'unknown', message: `the provider returned an unexpected HTTP status (${caught.statusCode ?? 'none'})` };
  }

  return { code: 'network', message: 'a network error occurred contacting the provider' };
}

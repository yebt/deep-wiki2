export type ApiHealthStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface ApiHealthResponse {
  readonly status: string;
}

export type ApiHealthFetcher = (url: string) => Promise<ApiHealthResponse>;

export interface UseApiHealthResult {
  readonly status: Ref<ApiHealthStatus>;
  readonly message: Ref<string>;
  readonly checkedAt: Ref<Date | null>;
  readonly check: () => Promise<void>;
}

/**
 * Pings apps/api's `/health` endpoint from the browser — the smoke page's
 * one piece of real behaviour beyond static markup, proving a deployed
 * apps/web instance can actually reach its configured backend. The
 * fetcher is injectable so this composable is testable without a live
 * network call or `registerEndpoint` mocking (see useApiHealth.test.ts).
 */
export function useApiHealth(
  fetcher: ApiHealthFetcher = (url) => $fetch(url),
): UseApiHealthResult {
  const status = ref<ApiHealthStatus>('idle');
  const message = ref('Not checked yet');
  const checkedAt = ref<Date | null>(null);

  async function check(): Promise<void> {
    status.value = 'loading';
    message.value = 'Checking API connection…';

    try {
      const config = useRuntimeConfig();
      const response = await fetcher(`${config.public.apiBaseUrl}/health`);

      if (response.status === 'ok') {
        status.value = 'ok';
        message.value = 'API reachable';
      } else {
        status.value = 'error';
        message.value = `API reported an unexpected status: ${response.status}`;
      }
    } catch (error) {
      status.value = 'error';
      message.value = error instanceof Error ? error.message : 'Unknown error reaching the API';
    } finally {
      checkedAt.value = new Date();
    }
  }

  return { status, message, checkedAt, check };
}

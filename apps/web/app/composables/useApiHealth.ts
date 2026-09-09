export type ApiHealthStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface ApiHealthResponse {
  readonly status: string;
}

export type ApiHealthFetcher = (url: string) => Promise<ApiHealthResponse>;

export interface UseApiHealthResult {
  readonly status: Ref<ApiHealthStatus>;
  readonly message: Ref<string>;
  /**
   * Technical detail behind an error (the underlying exception message or
   * response status), kept out of `message` so the badge never shows a raw
   * fetch error to the user. Meant for an unobtrusive surface (a tooltip)
   * or logging, not the primary error text — see docs/UI-CHECKLIST.md §3.
   */
  readonly detail: Ref<string | null>;
  readonly checkedAt: Ref<Date | null>;
  readonly check: () => Promise<void>;
}

/**
 * Turns a caught failure into a human-facing message plus a technical
 * detail string. Distinguishes "the request never reached the API"
 * (network error, connection refused, DNS/CORS failure — no response was
 * received) from "the API received the request and reported an error"
 * (a response with a non-2xx status came back), per docs/UI-CHECKLIST.md
 * §3: a recoverable error must say what failed in the user's terms and
 * never show a bare status code or raw technical string.
 */
function describeFailure(error: unknown): { message: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);

  if (serverResponded(error)) {
    return {
      message: 'The API responded with an error. Try again in a moment.',
      detail,
    };
  }

  return {
    message: 'Cannot reach the API. Check that it is running, then try again.',
    detail,
  };
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
  const detail = ref<string | null>(null);
  const checkedAt = ref<Date | null>(null);

  async function check(): Promise<void> {
    status.value = 'loading';
    message.value = 'Checking API connection…';
    detail.value = null;

    try {
      const config = useRuntimeConfig();
      const response = await fetcher(`${config.public.apiBaseUrl}/health`);

      if (response.status === 'ok') {
        status.value = 'ok';
        message.value = 'API reachable';
      } else {
        status.value = 'error';
        message.value = 'The API reported an unexpected status. Try again in a moment.';
        detail.value = `status: ${response.status}`;
      }
    } catch (error) {
      status.value = 'error';
      const failure = describeFailure(error);
      message.value = failure.message;
      detail.value = failure.detail;
    } finally {
      checkedAt.value = new Date();
    }
  }

  return { status, message, detail, checkedAt, check };
}

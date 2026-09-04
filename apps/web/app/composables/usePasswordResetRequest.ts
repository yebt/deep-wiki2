import { PasswordResetRequestSchema, type PasswordResetRequest, type PasswordResetResponse } from '@deep-wiki/contracts';

export type PasswordResetRequestStatus = 'idle' | 'loading' | 'sent' | 'network-error';

export type PasswordResetRequestFetcher = (input: PasswordResetRequest) => Promise<PasswordResetResponse>;

export interface UsePasswordResetRequestResult {
  readonly status: Ref<PasswordResetRequestStatus>;
  readonly message: Ref<string>;
  readonly requestReset: (input: PasswordResetRequest) => Promise<void>;
}

const GENERIC_SENT_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

/**
 * `POST /auth/password-reset` (authentication spec — "Password Reset
 * Responses Do Not Disclose Account Existence"). The single most
 * important rule in this composable: a known and an unknown account MUST
 * reach the byte-identical `sent` status and message. There is exactly
 * one success branch below — never two that happen to render the same
 * text, which would be one accidental edit away from a leak.
 */
export function usePasswordResetRequest(fetcher?: PasswordResetRequestFetcher): UsePasswordResetRequestResult {
  const post =
    fetcher ??
    ((input: PasswordResetRequest) => {
      const config = useRuntimeConfig();
      return $fetch<PasswordResetResponse>(`${config.public.apiBaseUrl}/auth/password-reset`, {
        method: 'POST',
        body: input,
        credentials: 'include',
      });
    });

  const status = ref<PasswordResetRequestStatus>('idle');
  const message = ref('');

  async function requestReset(input: PasswordResetRequest): Promise<void> {
    const parsed = PasswordResetRequestSchema.safeParse(input);
    if (!parsed.success) {
      status.value = 'idle';
      message.value = 'Enter your email address.';
      return;
    }

    status.value = 'loading';
    message.value = 'Sending…';

    try {
      await post(parsed.data);
      status.value = 'sent';
      message.value = GENERIC_SENT_MESSAGE;
    } catch {
      // Connectivity failures are orthogonal to account existence, so a
      // distinct state here discloses nothing — see the module doc above.
      status.value = 'network-error';
      message.value = 'Could not reach the server. Check your connection and try again.';
    }
  }

  return { status, message, requestReset };
}

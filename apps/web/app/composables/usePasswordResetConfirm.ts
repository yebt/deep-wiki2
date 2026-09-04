import {
  PasswordResetConfirmRequestSchema,
  type PasswordResetConfirmRequest,
  type PasswordResetConfirmResponse,
} from '@deep-wiki/contracts';

export type PasswordResetConfirmStatus = 'idle' | 'loading' | 'invalid-or-expired' | 'network-error' | 'success';

export type PasswordResetConfirmFetcher = (input: PasswordResetConfirmRequest) => Promise<PasswordResetConfirmResponse>;

interface ResponseError {
  readonly response: { readonly status?: number };
}

function hasResponse(error: unknown): error is ResponseError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    (error as { response?: unknown }).response !== undefined
  );
}

export interface UsePasswordResetConfirmResult {
  readonly status: Ref<PasswordResetConfirmStatus>;
  readonly message: Ref<string>;
  readonly confirmReset: (input: PasswordResetConfirmRequest) => Promise<void>;
}

/**
 * `POST /auth/password-reset/confirm` (authentication spec — "Password
 * Reset Tokens Are Hashed, Single-Use, Expiring"). The route does not
 * distinguish an expired token from an already-consumed one (both return
 * the same `400`), so this composable does not invent a distinction the
 * server cannot back up.
 */
export function usePasswordResetConfirm(fetcher?: PasswordResetConfirmFetcher): UsePasswordResetConfirmResult {
  const post =
    fetcher ??
    ((input: PasswordResetConfirmRequest) => {
      const config = useRuntimeConfig();
      return $fetch<PasswordResetConfirmResponse>(`${config.public.apiBaseUrl}/auth/password-reset/confirm`, {
        method: 'POST',
        body: input,
        credentials: 'include',
      });
    });

  const status = ref<PasswordResetConfirmStatus>('idle');
  const message = ref('');

  async function confirmReset(input: PasswordResetConfirmRequest): Promise<void> {
    const parsed = PasswordResetConfirmRequestSchema.safeParse(input);
    if (!parsed.success) {
      status.value = 'idle';
      message.value = 'Enter a new password.';
      return;
    }

    status.value = 'loading';
    message.value = 'Setting your new password…';

    try {
      await post(parsed.data);
      status.value = 'success';
      message.value = 'Your password has been changed.';
    } catch (error) {
      if (hasResponse(error)) {
        status.value = 'invalid-or-expired';
        message.value = 'This password reset link is invalid or has expired. Request a new one.';
      } else {
        status.value = 'network-error';
        message.value = 'Could not reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, message, confirmReset };
}

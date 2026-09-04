import { LoginRequestSchema, type LoginRequest, type LoginResponse } from '@deep-wiki/contracts';

export type LoginStatus = 'idle' | 'loading' | 'invalid-credentials' | 'network-error' | 'success';

export type LoginFetcher = (input: LoginRequest) => Promise<LoginResponse>;

/** Shape of the error ofetch/`$fetch` throws when the server responded (with a non-2xx status). */
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

export interface UseLoginResult {
  readonly status: Ref<LoginStatus>;
  readonly message: Ref<string>;
  readonly login: (input: LoginRequest) => Promise<void>;
}

/**
 * `POST /auth/login` (authentication spec). The session cookie is set by
 * the server response itself (`Set-Cookie`, `credentials: 'include'`);
 * nothing here ever reads or stores the token — it never appears in the
 * JSON body it validates against `LoginResponseSchema`-derived types.
 *
 * A rejected login and a nonexistent account produce the exact same
 * `invalid-credentials` status and message — this composable must not
 * reintroduce the account-enumeration oracle work unit 11 closed
 * server-side (design.md — "Account non-disclosure").
 */
export function useLogin(fetcher?: LoginFetcher): UseLoginResult {
  const post =
    fetcher ??
    ((input: LoginRequest) => {
      const config = useRuntimeConfig();
      return $fetch<LoginResponse>(`${config.public.apiBaseUrl}/auth/login`, {
        method: 'POST',
        body: input,
        credentials: 'include',
      });
    });

  const status = ref<LoginStatus>('idle');
  const message = ref('');

  async function login(input: LoginRequest): Promise<void> {
    const parsed = LoginRequestSchema.safeParse(input);
    if (!parsed.success) {
      status.value = 'invalid-credentials';
      message.value = 'Enter your email and password.';
      return;
    }

    status.value = 'loading';
    message.value = 'Signing in…';

    try {
      await post(parsed.data);
      status.value = 'success';
      message.value = 'Signed in.';
    } catch (error) {
      if (hasResponse(error)) {
        status.value = 'invalid-credentials';
        message.value = 'Incorrect email or password.';
      } else {
        status.value = 'network-error';
        message.value = 'Could not reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, message, login };
}

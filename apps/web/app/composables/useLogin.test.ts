import { describe, expect, test } from 'vitest';
import { useLogin } from './useLogin';

describe('useLogin', () => {
  test('starts idle', () => {
    const { status, message } = useLogin(async () => ({ ok: true }));

    expect(status.value).toBe('idle');
    expect(message.value).toBe('');
  });

  test('reports loading synchronously while the request is in flight', () => {
    let resolveFetch: (() => void) | undefined;
    const { status, login } = useLogin(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: true });
        }),
    );

    const pending = login({ email: 'a@example.com', password: 'x' });
    expect(status.value).toBe('loading');

    resolveFetch?.();
    return pending;
  });

  test('transitions to success on a valid login', async () => {
    const { status, login } = useLogin(async () => ({ ok: true }));

    await login({ email: 'a@example.com', password: 'correct' });

    expect(status.value).toBe('success');
  });

  test('reports invalid credentials without disclosing whether the email exists', async () => {
    const { status, message, login } = useLogin(async () => {
      throw Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
    });

    await login({ email: 'nobody@example.com', password: 'wrong' });

    expect(status.value).toBe('invalid-credentials');
    expect(message.value).toMatch(/incorrect email or password/i);
    expect(message.value).not.toMatch(/no account|does not exist|not found/i);
  });

  test('distinguishes a network failure from a rejected login, without a raw technical message', async () => {
    const { status, message, login } = useLogin(async () => {
      throw new Error('Failed to fetch');
    });

    await login({ email: 'a@example.com', password: 'x' });

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/could not reach the server/i);
    expect(message.value).not.toMatch(/failed to fetch/i);
  });
});

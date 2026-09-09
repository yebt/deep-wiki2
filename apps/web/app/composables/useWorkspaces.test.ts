import { describe, expect, test, vi } from 'vitest';
import { useWorkspaces } from './useWorkspaces';

function responseError(status: number) {
  return { response: { status } };
}

const alpha = { id: 'ws-1', name: 'Alpha Handbook', slug: 'alpha-handbook' };

describe('useWorkspaces', () => {
  test('starts idle and loads the list on success', async () => {
    const fetchWorkspaces = vi.fn(async () => ({ workspaces: [alpha] }));
    const { status, workspaces, load } = useWorkspaces({ fetchWorkspaces });

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('success');
    expect(workspaces.value).toEqual([alpha]);
  });

  test('an empty list is success with zero workspaces, never an error', async () => {
    const fetchWorkspaces = vi.fn(async () => ({ workspaces: [] }));
    const { status, workspaces, load } = useWorkspaces({ fetchWorkspaces });

    await load();

    expect(status.value).toBe('success');
    expect(workspaces.value).toEqual([]);
  });

  test('a 401 is its own state, so the screen can offer sign-in instead of a retry', async () => {
    const { status, load } = useWorkspaces({
      fetchWorkspaces: vi.fn(async () => {
        throw responseError(401);
      }),
    });

    await load();

    expect(status.value).toBe('unauthenticated');
  });

  test('an unreachable server is a recoverable error carrying a message the user can act on', async () => {
    const { status, message, load } = useWorkspaces({
      fetchWorkspaces: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try again/i);
  });

  test('a 500 is the same recoverable error, not a silent empty list', async () => {
    const { status, workspaces, load } = useWorkspaces({
      fetchWorkspaces: vi.fn(async () => {
        throw responseError(500);
      }),
    });

    await load();

    expect(status.value).toBe('network-error');
    expect(workspaces.value).toEqual([]);
  });
});

/**
 * ── The trap this bug hides behind ─────────────────────────────────────
 *
 * A mock that rejects with a plain `new Error('fetch failed')`, or with
 * `{ response: { status: 500 } }`, does NOT reproduce the defect: both
 * classify correctly even against the broken guard, so a test built on
 * either passes against the broken code and proves nothing.
 *
 * The bug only appears with ofetch's real shape — `response` present as an
 * own key and set to `undefined`, because no response ever arrived.
 * `'response' in error` is then `true`, so a guard that only tests key
 * presence lets `error.response.status` throw *inside the catch block*,
 * before any status is assigned. `status` never leaves its in-flight
 * value and the screen sits on its `aria-hidden` skeleton forever.
 *
 * So these assert the observable consequence — that the composable
 * SETTLES — and not only the classification: "throws inside catch" and
 * "returns the wrong status" are different bugs, and only the first
 * produced the blank screen.
 */
function unreachableApi(): Error & { readonly response: undefined } {
  // Object.assign copies an own `response` key whose value is `undefined`,
  // which is exactly what ofetch leaves behind when the request never got
  // a reply. `new Error(...)` alone, or a nested `{ status }`, does not.
  return Object.assign(new Error('fetch failed'), { response: undefined });
}

describe('useWorkspaces when the API never responded', () => {
  test('the fixture carries ofetch real shape, not a convenient mock', () => {
    const error = unreachableApi();

    expect('response' in error).toBe(true);
    expect(error.response).toBeUndefined();
  });

  test('settles into network-error instead of hanging on the loading skeleton', async () => {
    const { status, message, load } = useWorkspaces({
      fetchWorkspaces: vi.fn(async () => {
        throw unreachableApi();
      }),
    });

    const settled = await load().then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );

    expect(status.value).not.toBe('loading');
    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try again/i);
    expect(settled).toBe('resolved');
  });
});

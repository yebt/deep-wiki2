import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { localReturnPath, signInPath, useSignInRedirect } from './useSignInRedirect';

const { navigateToMock, useRouteMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(async () => {}),
  useRouteMock: vi.fn(() => ({ fullPath: '/workspaces/ws-1/members?tab=invites', query: {} })),
}));

mockNuxtImport('navigateTo', () => navigateToMock);
mockNuxtImport('useRoute', () => useRouteMock);

beforeEach(() => {
  navigateToMock.mockClear();
});

describe('localReturnPath', () => {
  test('keeps a path on this origin, query and hash included', () => {
    expect(localReturnPath('/pages/p-1/edit?x=1#top')).toBe('/pages/p-1/edit?x=1#top');
  });

  // `next` is read straight off the address bar, so anything that could
  // send the person off this origin after they typed their password must
  // be refused — an absolute URL, a scheme-relative `//host`, a
  // backslash Chrome would normalise to a slash.
  test.each(['https://evil.example/', '//evil.example/', '/\\evil.example', 'javascript:alert(1)', 'pages/p-1', '', 42, null, undefined, ['/a']])(
    'refuses %p',
    (raw) => {
      expect(localReturnPath(raw)).toBeNull();
    },
  );

  test('refuses the sign-in screen itself, so a return never loops', () => {
    expect(localReturnPath('/login')).toBeNull();
    expect(localReturnPath('/login?next=%2Fworkspaces')).toBeNull();
  });
});

describe('signInPath', () => {
  test('carries the return path in the query, encoded', () => {
    expect(signInPath('/workspaces/ws-1/members?tab=invites')).toBe('/login?next=%2Fworkspaces%2Fws-1%2Fmembers%3Ftab%3Dinvites');
  });

  test('is the bare sign-in screen when there is nowhere to return to', () => {
    expect(signInPath(null)).toBe('/login');
  });
});

describe('useSignInRedirect', () => {
  test('redirectToSignIn leaves for sign-in with the current address as the return path, replacing the entry', async () => {
    const { redirectToSignIn } = useSignInRedirect();

    await redirectToSignIn();

    expect(navigateToMock).toHaveBeenCalledWith('/login?next=%2Fworkspaces%2Fws-1%2Fmembers%3Ftab%3Dinvites', { replace: true });
  });

  test('redirectWhenSignedOut goes the moment a status reads unauthenticated, and not for any other status', async () => {
    const status = ref('loading');
    const { redirectWhenSignedOut } = useSignInRedirect();

    redirectWhenSignedOut(status);
    await nextTick();
    expect(navigateToMock).not.toHaveBeenCalled();

    status.value = 'network-error';
    await nextTick();
    expect(navigateToMock).not.toHaveBeenCalled();

    status.value = 'unauthenticated';
    await nextTick();
    expect(navigateToMock).toHaveBeenCalledTimes(1);
    expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/), { replace: true });
  });

  test('redirectWhenSignedOut also fires for a status that is already unauthenticated when watched', async () => {
    const { redirectWhenSignedOut } = useSignInRedirect();

    redirectWhenSignedOut(ref('unauthenticated'));
    await nextTick();

    expect(navigateToMock).toHaveBeenCalledTimes(1);
  });
});

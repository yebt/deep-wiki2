import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';

/**
 * `/` is a redirect, so what there is to assert is the route record rather
 * than any rendered markup. The record is read from the application's own
 * router — the same one the browser navigates with — so the assertion
 * fails if the redirect is removed, changed, or pointed somewhere that is
 * not a route.
 */
function inspectRoutes<T>(read: (router: ReturnType<typeof useRouter>) => T): Promise<T> {
  let captured!: T;
  const Probe = defineComponent({
    setup() {
      captured = read(useRouter());
      return () => h('div');
    },
  });
  return mountSuspended(Probe).then(() => captured);
}

describe('home route', () => {
  test('redirects to the workspace list rather than rendering a screen of its own', async () => {
    const redirect = await inspectRoutes((router) => router.getRoutes().find((route) => route.path === '/')?.redirect);

    expect(redirect).toBe('/workspaces');
  });

  test('the route it redirects to exists, so the redirect cannot land on a 404', async () => {
    const paths = await inspectRoutes((router) => router.getRoutes().map((route) => route.path));

    expect(paths).toContain('/workspaces');
  });
});

import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';

/**
 * `/` renders no screen of its own: its route record carries the
 * `last-workspace` middleware, which sends the person into the last
 * workspace they were in, or to the list when there is none
 * (`middleware/last-workspace.test.ts` holds where each case goes). What
 * there is to assert here is the record — read from the application's own
 * router, the one the browser navigates with — so the assertion fails if
 * the middleware is removed or a static redirect is put back in front of
 * it.
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
  test('is routed by the last-workspace middleware rather than a static redirect', async () => {
    const record = await inspectRoutes((router) => router.getRoutes().find((route) => route.path === '/'));

    expect(record?.redirect).toBeUndefined();
    expect(record?.meta.middleware).toEqual(['last-workspace']);
  });
});

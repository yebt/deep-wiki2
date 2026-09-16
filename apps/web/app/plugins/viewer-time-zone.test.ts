import { afterEach, describe, expect, test } from 'vitest';
import { markHydrated, viewerTimeZone } from '~/composables/useViewerTimeZone';
import { installViewerTimeZone } from './viewer-time-zone';

/**
 * A server-rendered document is hydrated in UTC — what the server
 * formatted — and hands the viewer their own zone once hydration
 * resolves; a client-only render never leaves the viewer's zone.
 */
describe('installViewerTimeZone', () => {
  afterEach(() => markHydrated());

  function fakeApp(serverRendered: boolean) {
    const hooks: Record<string, () => void> = {};
    return {
      app: { payload: { serverRendered }, hook: (name: string, fn: () => void) => (hooks[name] = fn) },
      resolve: () => hooks['app:suspense:resolve']?.(),
    };
  }

  test('a server-rendered document hydrates in UTC and switches to the viewer zone when hydration resolves', () => {
    const { app, resolve } = fakeApp(true);
    installViewerTimeZone(app);

    expect(viewerTimeZone()).toBe('UTC');
    resolve();
    expect(viewerTimeZone()).toBeUndefined();
  });

  test('a document that was not server-rendered stays in the viewer zone throughout', () => {
    const { app } = fakeApp(false);
    installViewerTimeZone(app);

    expect(viewerTimeZone()).toBeUndefined();
  });
});

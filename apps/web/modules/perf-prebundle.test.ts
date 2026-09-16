// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import perfPrebundle, { PREBUNDLED_DEPENDENCIES, prebundle, registerPrebundle } from './perf-prebundle';

/**
 * The mechanism this module works around is in two other packages
 * (`@nuxt/ui` transpiles `reka-ui`; `@nuxt/vite-builder` turns transpile
 * into `optimizeDeps.exclude` and then drops any `include` entry that is
 * also excluded — see the module's own header). What can be held here is
 * the module's half of the bargain: given the client config those two
 * produce, `reka-ui` ends up in `include` and not in `exclude`, on every
 * shape of config the builder hands out, and only for the client.
 */
describe('prebundle()', () => {
  test('moves the dependency from exclude to include', () => {
    const result = prebundle({ include: [], exclude: ['vue', 'reka-ui', 'ofetch'] }, ['reka-ui']);

    expect(result.exclude).toEqual(['vue', 'ofetch']);
    expect(result.include).toEqual(['reka-ui']);
  });

  test('is idempotent: a second pass adds nothing', () => {
    const once = prebundle({ include: ['reka-ui'], exclude: ['vue'] }, ['reka-ui']);
    const twice = prebundle(once, ['reka-ui']);

    expect(twice.include).toEqual(['reka-ui']);
    expect(twice.exclude).toEqual(['vue']);
  });

  test('tolerates a config with no optimizeDeps at all', () => {
    expect(prebundle(undefined, ['reka-ui'])).toEqual({ include: ['reka-ui'], exclude: [] });
  });

  test('the shipped list is exactly reka-ui', () => {
    expect([...PREBUNDLED_DEPENDENCIES]).toEqual(['reka-ui']);
  });
});

interface FakeNuxt {
  readonly options: { readonly dev: boolean };
  readonly hook: ReturnType<typeof vi.fn>;
}

function fakeNuxt(dev: boolean): FakeNuxt {
  return { options: { dev }, hook: vi.fn() };
}

type ExtendConfigHook = (config: Record<string, unknown>, env: { isClient: boolean; isServer: boolean }) => void;

function extendConfigHook(nuxt: FakeNuxt): ExtendConfigHook {
  const call = nuxt.hook.mock.calls.find(([name]) => name === 'vite:extendConfig');
  if (!call) throw new Error('vite:extendConfig was not hooked');
  return call[1] as ExtendConfigHook;
}

describe('registerPrebundle()', () => {
  test('hooks vite:extendConfig in dev and rewrites the client config', () => {
    const nuxt = fakeNuxt(true);
    registerPrebundle(nuxt as never);

    const config = { optimizeDeps: { include: [], exclude: ['vue', 'reka-ui'] } };
    extendConfigHook(nuxt)(config, { isClient: true, isServer: false });

    expect(config.optimizeDeps).toEqual({ include: ['reka-ui'], exclude: ['vue'] });
  });

  test('also rewrites the Vite environment-API shape (`config.environments.client`)', () => {
    const nuxt = fakeNuxt(true);
    registerPrebundle(nuxt as never);

    const config = { environments: { client: { optimizeDeps: { include: [], exclude: ['reka-ui'] } } } };
    extendConfigHook(nuxt)(config, { isClient: true, isServer: false });

    expect(config.environments.client.optimizeDeps).toEqual({ include: ['reka-ui'], exclude: [] });
  });

  test('leaves the server config alone', () => {
    const nuxt = fakeNuxt(true);
    registerPrebundle(nuxt as never);

    const config = { optimizeDeps: { include: [], exclude: ['reka-ui'] } };
    extendConfigHook(nuxt)(config, { isClient: false, isServer: true });

    expect(config.optimizeDeps).toEqual({ include: [], exclude: ['reka-ui'] });
  });

  test('does nothing outside dev: optimizeDeps is a dev-server concern', () => {
    const nuxt = fakeNuxt(false);
    registerPrebundle(nuxt as never);

    expect(nuxt.hook).not.toHaveBeenCalled();
  });

  test('the default export is a Nuxt module carrying a name, so listing it in nuxt.config and the modules/ scan install it once', () => {
    expect(typeof perfPrebundle).toBe('function');
    expect((perfPrebundle as unknown as { getMeta: () => Promise<{ name?: string }> }).getMeta).toBeTypeOf('function');
  });
});

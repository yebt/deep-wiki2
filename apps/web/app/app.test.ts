import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import App from './app.vue';
import IndexPage from './pages/index.vue';

/**
 * The root component. It renders no screen of its own, so its contract is
 * entirely about what it puts *around* every screen:
 *
 * - `UApp`, which installs the Reka providers `UTooltip`, `UModal` and
 *   `useToast()` inject. Every page suite in this app mounts its page
 *   inside a `UApp` by hand for exactly that reason, and each of those is
 *   a claim about this file — none of them checks it. A page rendered
 *   beside `UApp` rather than inside it throws on the first tooltip.
 * - the document language, which is the one head value a screen inherits
 *   rather than states: `pages/index.vue` sets no head at all.
 *
 * `error.vue` is deliberately not covered here — Nuxt renders it *instead
 * of* this component, which is why it declares its own `UApp` and its own
 * `lang`, and `error.test.ts` holds that.
 */
const { useApiHealthMock } = vi.hoisted(() => ({ useApiHealthMock: vi.fn() }));

mockNuxtImport('useApiHealth', () => useApiHealthMock);

function mountApp() {
  useApiHealthMock.mockReturnValue({
    status: ref('idle'),
    message: ref('Not checked yet'),
    detail: ref(null),
    checkedAt: ref(null),
    check: vi.fn(async () => {}),
  });
  return mountSuspended(App);
}

describe('app root', () => {
  test('the routed screen renders inside UApp, not beside it', async () => {
    const component = await mountApp();

    const app = component.findComponent(UApp);
    expect(app.exists()).toBe(true);
    // The page is a descendant of the provider, which is what makes every
    // page suite's `h(UApp, …, () => h(Page))` an honest reproduction of
    // how the page actually ships.
    expect(app.findComponent(IndexPage).exists()).toBe(true);
    expect(app.element.contains(component.get('main').element)).toBe(true);
  });

  test('the routed screen really is the one the router resolved', async () => {
    const component = await mountApp();

    // `<NuxtPage />`, not a hardcoded child: the shell renders whatever the
    // route resolved to, and `/` is the smoke page.
    expect(component.findComponent(IndexPage).exists()).toBe(true);
    expect(component.findAll('main')).toHaveLength(1);
  });

  test('the document declares its language, on a route that declares none itself', async () => {
    await mountApp();

    // `pages/index.vue` sets no head of its own, so this value can only
    // have come from the shell. Without it a screen reader has to guess the
    // language of every page in the product.
    //
    // `waitFor` because unhead patches the real document asynchronously,
    // after the component tree has already settled.
    await vi.waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('en'));
  });
});

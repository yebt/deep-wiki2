import { NuxtLayout, NuxtLoadingIndicator, UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import App from './app.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import WorkspacesPage from './pages/workspaces/index.vue';

/**
 * The root component. It renders no screen of its own, so its contract is
 * entirely about what it puts *around* every screen:
 *
 * - `UApp`, which installs the Reka providers `UTooltip`, `UModal` and
 *   `useToast()` inject. Every page suite in this app mounts its page
 *   inside a `UApp` by hand for exactly that reason, and each of those is
 *   a claim about this file — none of them checks it. A page rendered
 *   beside `UApp` rather than inside it throws on the first tooltip.
 * - `NuxtLayout`, so a screen that names a layout gets it. The workspace
 *   layout is what lets the sidebar be mounted once and survive every
 *   navigation inside a workspace; without this wrapper `definePageMeta({
 *   layout })` is ignored and every screen silently falls back to its own
 *   per-route frame.
 * - the document language, which is the one head value a screen inherits
 *   rather than states: `pages/workspaces/index.vue` sets only a title.
 *
 * The route mounted here is `/workspaces`, not `/`: `/` is routed onward
 * by middleware (see `pages/index.vue`), so it renders no component to
 * assert against. `error.vue` is deliberately not covered here — Nuxt renders it
 * *instead of* this component, which is why it declares its own `UApp` and
 * its own `lang`, and `error.test.ts` holds that.
 */
const { useWorkspacesMock } = vi.hoisted(() => ({ useWorkspacesMock: vi.fn() }));

mockNuxtImport('useWorkspaces', () => useWorkspacesMock);

function mountApp() {
  useWorkspacesMock.mockReturnValue({
    status: ref('success'),
    workspaces: ref([{ id: 'ws-1', name: 'Alpha Handbook', slug: 'alpha-handbook' }]),
    message: ref(''),
    load: vi.fn(async () => {}),
  });
  return mountSuspended(App, { route: '/workspaces' });
}

describe('app root', () => {
  test('the routed screen renders inside UApp, not beside it', async () => {
    const component = await mountApp();

    const app = component.findComponent(UApp);
    expect(app.exists()).toBe(true);
    // The page is a descendant of the provider, which is what makes every
    // page suite's `h(UApp, …, () => h(Page))` an honest reproduction of
    // how the page actually ships.
    expect(app.findComponent(WorkspacesPage).exists()).toBe(true);
    expect(app.element.contains(component.get('main').element)).toBe(true);
  });

  test('the routed screen renders inside NuxtLayout, so a page’s layout is honoured', async () => {
    const component = await mountApp();

    const layout = component.findComponent(NuxtLayout);
    expect(layout.exists()).toBe(true);
    expect(layout.findComponent(WorkspacesPage).exists()).toBe(true);
  });

  // The product's one confirm dialog is mounted here, once, inside the
  // provider it needs, so any screen can ask through `useConfirm()`; a
  // screen that mounted its own would be a second dialog (§4.1).
  test('mounts the confirm dialog host once, inside UApp', async () => {
    const component = await mountApp();

    const hosts = component.findComponent(UApp).findAllComponents(ConfirmDialog);
    expect(hosts).toHaveLength(1);
  });

  /**
   * The toaster is `UApp`'s own, and the one thing this product states
   * about it is how many confirmations may stand at once: a stack four
   * deep stops being a confirmation and becomes a wall over the document,
   * which is the opposite of what moving the banners into toasts was for
   * (owner decision, 2026-09-23; docs/UI-CHECKLIST.md §4.12). Everything
   * else about the tier — the status role, the politeness, the dismissal,
   * the duration — is `useStatusToast`'s and is asserted there.
   */
  test('caps how many toasts may stand at once', async () => {
    const component = await mountApp();

    // `findComponent` types `UApp` as a DOM wrapper here (the same reason
    // the tests above reach for `exists()` and `findAllComponents`), so the
    // props are read through the component's own instance.
    const app = component.findComponent(UApp) as unknown as { props: (name: string) => unknown };
    expect(app.props('toaster')).toMatchObject({ max: 3 });
  });

  test('the routed screen really is the one the router resolved', async () => {
    const component = await mountApp();

    // `<NuxtPage />`, not a hardcoded child: the shell renders whatever the
    // route resolved to.
    expect(component.findComponent(WorkspacesPage).exists()).toBe(true);
    expect(component.findAll('main')).toHaveLength(1);
  });

  // Fix D (docs/TODO.md Findings 2026-09-16, "edit-mode latency"): no
  // screen said a hop was in flight. The indicator is the shell's — one
  // for every route — in the primary role at 3px, with its progress
  // curve supplied by `~/utils/loading-progress` so reduced motion gets a
  // bar that does not creep.
  test('mounts one route-change indicator, in the primary role at 3px, inside UApp', async () => {
    const component = await mountApp();

    const indicators = component.findAllComponents(NuxtLoadingIndicator);
    expect(indicators).toHaveLength(1);
    const indicator = indicators[0]!;
    expect(indicator.props('color')).toBe('var(--ui-primary)');
    expect(indicator.props('errorColor')).toBe('var(--ui-error)');
    expect(indicator.props('height')).toBe(3);
    expect(typeof indicator.props('estimatedProgress')).toBe('function');
    expect(component.findComponent(UApp).findComponent(NuxtLoadingIndicator).exists()).toBe(true);
  });

  test('the document declares its language, on a route that declares none itself', async () => {
    await mountApp();

    // `pages/workspaces/index.vue` sets no `htmlAttrs` of its own, so this
    // value can only have come from the shell. Without it a screen reader
    // has to guess the language of every page in the product.
    //
    // `waitFor` because unhead patches the real document asynchronously,
    // after the component tree has already settled.
    await vi.waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('en'));
  });
});

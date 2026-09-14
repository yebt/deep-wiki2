import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import WorkspacesPage from './index.vue';

const { useWorkspacesMock } = vi.hoisted(() => ({ useWorkspacesMock: vi.fn() }));

mockNuxtImport('useWorkspaces', () => useWorkspacesMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(WorkspacesPage) }),
});

const alpha = { id: 'ws-1', name: 'Alpha Handbook', slug: 'alpha-handbook' };
const bravo = { id: 'ws-2', name: 'Bravo Handbook', slug: 'bravo-handbook' };

function mockWorkspaces(overrides: { status?: string; workspaces?: unknown[]; message?: string } = {}) {
  const load = vi.fn(async () => {});
  useWorkspacesMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    workspaces: ref(overrides.workspaces ?? []),
    message: ref(overrides.message ?? ''),
    load,
  });
  return { load };
}

describe('workspaces index screen', () => {
  test('renders one h1 and the shell landmarks', async () => {
    mockWorkspaces({ status: 'success', workspaces: [alpha] });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
  });

  test('renders a skeleton shaped like the list while it loads, not a spinner', async () => {
    mockWorkspaces({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="workspace-list-skeleton"]').exists()).toBe(true);
  });

  test('each workspace is a link into its own navigation tree', async () => {
    mockWorkspaces({ status: 'success', workspaces: [alpha, bravo] });
    const component = await mountSuspended(PageInApp);

    const hrefs = component.findAll('a').map((a) => a.attributes('href'));
    expect(hrefs).toContain('/workspaces/ws-1/tree');
    expect(hrefs).toContain('/workspaces/ws-2/tree');
    expect(component.text()).toContain('Alpha Handbook');
    expect(component.text()).toContain('Bravo Handbook');
  });

  test('reading no workspaces is a calm state naming the object, and is not announced as an alert', async () => {
    mockWorkspaces({ status: 'success', workspaces: [] });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/no workspaces/i);
    expect(component.findAll('[role="alert"]')).toHaveLength(0);
    // A caller who can read nothing must not be shown a retry, which would
    // suggest something failed.
    const retry = component.findAll('button').find((b) => /retry/i.test(b.text()));
    expect(retry).toBeUndefined();
  });

  test('a failed request is a recoverable error with a retry that re-runs the request', async () => {
    const { load } = mockWorkspaces({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp);

    const alert = component.get('[role="alert"]');
    expect(alert.text()).toMatch(/cannot reach the server/i);

    const retry = component.findAll('button').find((b) => /retry/i.test(b.text()));
    expect(retry, 'expected a button whose accessible text names the retry action').toBeDefined();
    load.mockClear();
    await retry!.trigger('click');
    expect(load).toHaveBeenCalled();
  });

  test('a signed-out visitor is offered sign-in, not a retry', async () => {
    mockWorkspaces({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp);

    const signIn = component.findAll('a').find((a) => /sign in/i.test(a.text()));
    expect(signIn, 'expected a link whose accessible text names signing in').toBeDefined();
    expect(signIn!.attributes('href')).toBe('/login');
  });
});

/**
 * `/workspaces/` — the address a user is left holding after deleting the id
 * off a tree URL, and the one this batch found matching no route at all, so
 * the framework's own 404 answered for it.
 */
describe('the workspaces index route', () => {
  test('resolves /workspaces/ with no id to the list instead of falling through to a 404', async () => {
    let resolved!: { name: unknown; matched: number };
    const Probe = defineComponent({
      setup() {
        const route = useRouter().resolve('/workspaces/');
        resolved = { name: route.name, matched: route.matched.length };
        return () => h('div');
      },
    });
    await mountSuspended(Probe);

    expect(resolved.matched).toBeGreaterThan(0);
    expect(resolved.name).toBe('workspaces');
  });
});

describe('the new-workspace affordance', () => {
  test('a signed-in caller can reach the new-workspace screen from the list, whether or not it is empty', async () => {
    mockWorkspaces({ status: 'success', workspaces: [] });
    const empty = await mountSuspended(PageInApp);
    const fromEmpty = empty.findAll('a').find((a) => /new workspace/i.test(a.text()));
    expect(fromEmpty?.attributes('href')).toBe('/workspaces/new');

    mockWorkspaces({ status: 'success', workspaces: [alpha] });
    const loaded = await mountSuspended(PageInApp);
    const fromLoaded = loaded.findAll('a').find((a) => /new workspace/i.test(a.text()));
    expect(fromLoaded?.attributes('href')).toBe('/workspaces/new');
  });

  test('a signed-out visitor is not offered the new-workspace screen', async () => {
    mockWorkspaces({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('a').find((a) => /new workspace/i.test(a.text()))).toBeUndefined();
  });
});

import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import ReadPage from './index.vue';

const { usePageReadMock, useRouteMock } = vi.hoisted(() => ({
  usePageReadMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'page-1' } })),
}));

mockNuxtImport('usePageRead', () => usePageReadMock);
mockNuxtImport('useRoute', () => useRouteMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(ReadPage) }),
});

function mockRead(overrides: Partial<{ status: string; html: string; title: string; message: string }> = {}) {
  const load = vi.fn(async () => {});
  usePageReadMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    html: ref(overrides.html ?? ''),
    title: ref(overrides.title ?? ''),
    message: ref(overrides.message ?? ''),
    load,
  });
  return load;
}

describe('read-mode page', () => {
  test('renders the loading skeleton, not a spinner, while the request is in flight', async () => {
    mockRead({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="read-skeleton"]').exists()).toBe(true);
  });

  test('renders the page title as the one h1 and the cached HTML as body content, with the semantic landmarks', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('A Page');
    expect(component.html()).toContain('Hello from cache');
  });

  test('renders a distinct permission-denied state on forbidden, not a generic error, and withholds Edit', async () => {
    mockRead({ status: 'forbidden' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/don't have access/i);
    expect(component.text()).not.toMatch(/does not exist/i);
    expect(component.find('a[href*="/edit"]').exists()).toBe(false);
  });

  test('renders a distinct not-found state, different from permission-denied, and withholds Edit', async () => {
    mockRead({ status: 'not-found' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/does not exist/i);
    expect(component.text()).not.toMatch(/don't have access/i);
    expect(component.find('a[href*="/edit"]').exists()).toBe(false);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockRead({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp);

    const retry = component.get('button[data-testid="read-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

});

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import IndexPage from './index.vue';

const { useApiHealthMock } = vi.hoisted(() => ({ useApiHealthMock: vi.fn() }));

mockNuxtImport('useApiHealth', () => useApiHealthMock);

describe('smoke page', () => {
  test('renders one h1 and the semantic landmarks (header, main, footer)', async () => {
    useApiHealthMock.mockReturnValue({
      status: ref('idle'),
      message: ref('Not checked yet'),
      checkedAt: ref(null),
      check: vi.fn(async () => {}),
    });

    const component = await mountSuspended(IndexPage);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
  });

  test('announces API health via an accessible live region, paired with text', async () => {
    useApiHealthMock.mockReturnValue({
      status: ref('ok'),
      message: ref('API reachable'),
      checkedAt: ref(new Date()),
      check: vi.fn(async () => {}),
    });

    const component = await mountSuspended(IndexPage);
    const region = component.get('[role="status"]');

    expect(region.text()).toMatch(/reachable/i);
  });

  test('surfaces a recoverable error state with a retry affordance', async () => {
    const check = vi.fn(async () => {});
    useApiHealthMock.mockReturnValue({
      status: ref('error'),
      message: ref('network down'),
      checkedAt: ref(new Date()),
      check,
    });

    const component = await mountSuspended(IndexPage);
    const region = component.get('[role="status"]');
    expect(region.text()).toMatch(/network down/i);

    const buttons = component.findAll('button');
    const retry = buttons.find((button) => /re-check/i.test(button.text()));
    expect(retry, 'expected a button whose accessible text names the retry action').toBeDefined();

    await retry!.trigger('click');
    expect(check).toHaveBeenCalled();
  });

  test('the color-mode toggle has an accessible name distinct from its icon', async () => {
    useApiHealthMock.mockReturnValue({
      status: ref('idle'),
      message: ref('Not checked yet'),
      checkedAt: ref(null),
      check: vi.fn(async () => {}),
    });

    const component = await mountSuspended(IndexPage);
    const toggle = component.get('[aria-label*="theme" i], [aria-label*="color mode" i]');

    expect(toggle.attributes('aria-label')).toBeTruthy();
  });
});

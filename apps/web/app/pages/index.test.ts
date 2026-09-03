import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import IndexPage from './index.vue';

const { useApiHealthMock } = vi.hoisted(() => ({ useApiHealthMock: vi.fn() }));

mockNuxtImport('useApiHealth', () => useApiHealthMock);

/**
 * The page renders inside `<UApp>` in app.vue, and depends on it: `UApp`
 * installs Reka's tooltip/overlay providers that `UTooltip` injects. Mount
 * it the way it actually ships rather than in isolation — a page that only
 * works without its app shell is not evidence of anything.
 */
const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(IndexPage) }),
});

describe('smoke page', () => {
  test('renders one h1 and the semantic landmarks (header, main, footer)', async () => {
    useApiHealthMock.mockReturnValue({
      status: ref('idle'),
      message: ref('Not checked yet'),
      detail: ref(null),
      checkedAt: ref(null),
      check: vi.fn(async () => {}),
    });

    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
  });

  test('announces API health via an accessible live region, paired with text', async () => {
    useApiHealthMock.mockReturnValue({
      status: ref('ok'),
      message: ref('API reachable'),
      detail: ref(null),
      checkedAt: ref(new Date()),
      check: vi.fn(async () => {}),
    });

    const component = await mountSuspended(PageInApp);
    const region = component.get('[role="status"]');

    expect(region.text()).toMatch(/reachable/i);
  });

  test('surfaces a recoverable error state with a retry affordance', async () => {
    const check = vi.fn(async () => {});
    useApiHealthMock.mockReturnValue({
      status: ref('error'),
      message: ref('network down'),
      detail: ref('fetch failed: ECONNREFUSED'),
      checkedAt: ref(new Date()),
      check,
    });

    const component = await mountSuspended(PageInApp);
    const region = component.get('[role="status"]');
    expect(region.text()).toMatch(/network down/i);
    // The technical detail is rendered as readable supporting text, not
    // hidden in a `title` attribute (docs/UI-CHECKLIST.md §3, §5).
    expect(region.text()).toMatch(/ECONNREFUSED/);

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
      detail: ref(null),
      checkedAt: ref(null),
      check: vi.fn(async () => {}),
    });

    const component = await mountSuspended(PageInApp);
    const toggle = component.get('[aria-label*="theme" i], [aria-label*="color mode" i]');

    expect(toggle.attributes('aria-label')).toBeTruthy();
  });
});

import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import DashboardPanel from './DashboardPanel.vue';

function mount(props: { title: string; empty: boolean }, slots: Record<string, () => ReturnType<typeof h>> = {}) {
  return mountSuspended(
    defineComponent({
      name: 'PanelInApp',
      setup: () => () => h(UApp, null, { default: () => h(DashboardPanel, props, slots) }),
    }),
  );
}

describe('DashboardPanel', () => {
  test('is a region named by its own heading, with the list inside it', async () => {
    const component = await mount({ title: 'Recent changes', empty: false }, { default: () => h('ul', { 'data-testid': 'list' }, 'rows') });

    const section = component.get('section');
    const heading = section.get('h2');
    expect(heading.text()).toBe('Recent changes');
    expect(section.attributes('aria-labelledby')).toBe(heading.attributes('id'));
    expect(section.find('[data-testid="list"]').exists()).toBe(true);
    expect(section.find('[data-testid="panel-empty"]').exists()).toBe(false);
  });

  test('when empty, the teaching sentence replaces the list rather than standing beside an empty one', async () => {
    const component = await mount(
      { title: 'Editing now', empty: true },
      { default: () => h('ul', { 'data-testid': 'list' }), empty: () => h('span', 'Nobody is editing right now.') },
    );

    expect(component.get('[data-testid="panel-empty"]').text()).toBe('Nobody is editing right now.');
    expect(component.find('[data-testid="list"]').exists()).toBe(false);
  });
});

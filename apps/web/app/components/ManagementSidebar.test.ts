import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import ManagementSidebar from './ManagementSidebar.vue';

/** The real router is placed at `path`: `aria-current` comes from the router's own exact match, not from a mocked route. */
function mount(path: string) {
  return mountSuspended(
    defineComponent({
      name: 'ManagementInApp',
      setup: () => () => h(UApp, null, { default: () => h(ManagementSidebar, { workspaceId: 'ws-1' }) }),
    }),
    { route: path },
  );
}

/**
 * The sidebar's management region: the way back to the workspace first,
 * then every door that is management, grouped by whose it is. What this
 * holds is the *shape* — which doors exist, in which group, and that the
 * one the person is on is marked — not the screens behind them.
 */
describe('ManagementSidebar', () => {
  test('leads with the way back to the workspace, then the three groups in order, each door a real link', async () => {
    const component = await mount('/workspaces/ws-1/members');

    const back = component.get('a[href="/workspaces/ws-1"]');
    expect(back.text()).toMatch(/back to workspace/i);

    const text = component.text();
    const order = ['Back to workspace', 'Workspace', 'Members', 'Settings', 'AI & models', 'Instance', 'Registration settings', 'You', 'Profile'];
    const positions = order.map((label) => text.indexOf(label));
    expect(positions.every((position) => position >= 0), `every label present: ${JSON.stringify(positions)}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // Every door goes somewhere — no dead link, no control that does
    // nothing (docs/UI-CHECKLIST.md §6).
    const hrefs = component.findAll('a').map((a) => a.attributes('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/workspaces/ws-1/members',
        '/workspaces/ws-1/settings',
        '/workspaces/ws-1/ai',
        '/admin/registration',
        '/account',
      ]),
    );
    // The group headings are headings, not links.
    expect(component.findAll('a').map((a) => a.text())).not.toContain('Workspace');
  });

  test('marks the door of the screen the person is on — and only that one', async () => {
    const component = await mount('/workspaces/ws-1/members');

    // `exact`: the way back is `/workspaces/ws-1`, a prefix of every
    // management address, and must not read as current on all of them.
    const current = component.findAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.text()).toBe('Members');
  });

  test('every door is a tab stop: nothing is rendered disabled', async () => {
    const component = await mount('/workspaces/ws-1/members');

    expect(component.findAll('[aria-disabled="true"], [tabindex="-1"]')).toHaveLength(0);
  });
});

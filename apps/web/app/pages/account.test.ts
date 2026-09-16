import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import WorkspaceSidebar from '~/components/WorkspaceSidebar.vue';
import { LAST_WORKSPACE_COOKIE } from '~/composables/useCurrentWorkspace';
import AccountPage from './account.vue';

const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };
const PageInApp = defineComponent({ name: 'PageInApp', setup: () => () => h(UApp, null, { default: () => h(AccountPage) }) });

/**
 * The person's own settings: a placeholder with an honest state and the
 * one thing that can be done today (docs/UI-CHECKLIST.md §3). It stands
 * in the workspace frame when a workspace is remembered and in the
 * document frame when none is — the same rule as `/admin/registration`.
 */
describe('account placeholder', () => {
  test('with nothing remembered: the document frame, one h1 under a "You" eyebrow, the notice, and the reset-password door', async () => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=; path=/; max-age=0`;
    const component = await mountSuspended(PageInApp, { ...FRAME_STUBS, route: '/account' });

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Profile');
    expect(component.text()).toContain('You');
    expect(component.find('footer').exists(), 'the document frame has a footer').toBe(true);
    const notice = component.get('main [role="status"]');
    expect(notice.text()).toMatch(/not built yet/i);
    expect(component.findAll('a').find((a) => /reset password/i.test(a.text()))?.attributes('href')).toBe('/forgot-password');
  });

  test('with a workspace remembered: the workspace frame, its sidebar in management mode', async () => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=ws-1; path=/`;
    const component = await mountSuspended(PageInApp, { ...FRAME_STUBS, route: '/account' });

    expect(component.find('footer').exists(), 'inside the frame there is no footer').toBe(false);
    const sidebar = component.findComponent(WorkspaceSidebar);
    expect(sidebar.exists()).toBe(true);
    expect(sidebar.props('mode')).toBe('management');
    expect(sidebar.props('workspaceId')).toBe('ws-1');
  });
});

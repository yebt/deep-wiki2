import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import SettingsPage from './settings.vue';

const { useRouteMock } = vi.hoisted(() => ({ useRouteMock: vi.fn(() => ({ params: { workspaceId: 'ws-1' }, meta: { sidebar: 'management' } })) }));
mockNuxtImport('useRoute', () => useRouteMock);

const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };
const PageInApp = defineComponent({ name: 'PageInApp', setup: () => () => h(UApp, null, { default: () => h(SettingsPage) }) });

/** A placeholder is a real screen with an honest state and a way forward, never a dead link (docs/UI-CHECKLIST.md §3, §6). */
describe('workspace settings placeholder', () => {
  test('one h1 naming the screen, a "not built yet" notice in the product\'s words, and the door to what exists today', async () => {
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Settings');
    const notice = component.get('main [role="status"]');
    expect(notice.text()).toMatch(/not built yet/i);
    expect(notice.text()).toMatch(/managed under Members/);
    expect(component.findAll('a').find((a) => a.text() === 'Members')?.attributes('href')).toBe('/workspaces/ws-1/members');
    expect(component.findAll('[role="alert"]')).toHaveLength(0);
  });

  test('is a management screen inside the workspace layout', async () => {
    const route = useRouter().getRoutes().find((candidate) => candidate.path === '/workspaces/:workspaceId()/settings');
    expect(route?.meta).toMatchObject({ layout: 'workspace', sidebar: 'management' });
  });
});

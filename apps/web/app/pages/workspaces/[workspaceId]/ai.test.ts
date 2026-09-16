import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import AiPage from './ai.vue';

const { useRouteMock } = vi.hoisted(() => ({ useRouteMock: vi.fn(() => ({ params: { workspaceId: 'ws-1' }, meta: { sidebar: 'management' } })) }));
mockNuxtImport('useRoute', () => useRouteMock);

const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };
const PageInApp = defineComponent({ name: 'PageInApp', setup: () => () => h(UApp, null, { default: () => h(AiPage) }) });

/** A placeholder is a real screen with an honest state and a way forward, never a dead link (docs/UI-CHECKLIST.md §3, §6). */
describe('workspace AI & models placeholder', () => {
  test('one h1 naming the screen, a "not built yet" notice that says nothing is switched on, and the way back', async () => {
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('AI & models');
    const notice = component.get('main [role="status"]');
    expect(notice.text()).toMatch(/not built yet/i);
    expect(notice.text()).toMatch(/no AI feature is switched on/i);
    expect(component.findAll('a').find((a) => /back to workspace/i.test(a.text()))?.attributes('href')).toBe('/workspaces/ws-1');
  });

  test('is a management screen inside the workspace layout', async () => {
    const route = useRouter().getRoutes().find((candidate) => candidate.path === '/workspaces/:workspaceId()/ai');
    expect(route?.meta).toMatchObject({ layout: 'workspace', sidebar: 'management' });
  });
});

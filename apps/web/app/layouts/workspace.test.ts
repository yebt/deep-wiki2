import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import WorkspaceFrame from '~/components/WorkspaceFrame.vue';
import WorkspaceSidebar from '~/components/WorkspaceSidebar.vue';
import WorkspaceLayout from './workspace.vue';

const { useWorkspaceTreeMock, useWorkspaceDirectoryMock } = vi.hoisted(() => ({
  useWorkspaceTreeMock: vi.fn(),
  useWorkspaceDirectoryMock: vi.fn(),
}));
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);

useWorkspaceTreeMock.mockReturnValue({
  status: ref('success'),
  nodes: ref([]),
  rootId: ref('root-1'),
  message: ref(''),
  collapsedIds: computed(() => new Set<string>()),
  selectedId: ref(null),
  load: vi.fn(async () => {}),
  reorder: vi.fn(async () => true),
  toggleCollapsed: vi.fn(),
  reveal: vi.fn(),
  pathTo: () => [],
});
useWorkspaceDirectoryMock.mockReturnValue({
  status: ref('success'),
  workspaces: computed(() => [{ id: 'ws-1', name: 'Acme', slug: 'acme' }]),
  ensure: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  nameOf: (id: string) => (id === 'ws-1' ? 'Acme' : null),
  slugOf: (id: string) => (id === 'ws-1' ? 'acme' : null),
  idOf: (slug: string) => (slug === 'acme' ? 'ws-1' : null),
});

/**
 * The layout every screen inside a workspace opts into with
 * `definePageMeta({ layout: 'workspace' })`. Nuxt mounts a layout once
 * and swaps the page beneath it, which is the whole reason it exists:
 * before it, every route rendered its own `AppShell` and the sidebar was
 * rebuilt on each navigation — tree scroll reset, a drag mid-navigation
 * lost. What a unit test can hold is the plumbing: the frame it mounts
 * is the one `AppShell` also uses, the page renders inside it, and a
 * screen that names its node through `useWorkspaceFrame` reaches the
 * sidebar. That the sidebar's DOM *survives a navigation* is a claim
 * about the router and the browser: `e2e/frame.spec.ts`, "the sidebar
 * survives a navigation", is its owner.
 */
describe('workspace layout', () => {
  test('mounts the one workspace frame around the page, and a screen’s node reaches the sidebar through the frame context', async () => {
    const Screen = defineComponent({
      setup() {
        useWorkspaceFrame()!.setNodeId('page-1');
        return () => h('p', { 'data-testid': 'screen' }, 'the screen');
      },
    });
    useCurrentWorkspace().enter({ id: 'ws-1', slug: 'acme' });
    const component = await mountSuspended(
      defineComponent({
        name: 'LayoutInApp',
        setup: () => () => h(UApp, null, { default: () => h(WorkspaceLayout, null, { default: () => h(Screen) }) }),
      }),
    );

    const frame = component.findComponent(WorkspaceFrame);
    expect(frame.exists()).toBe(true);
    expect(frame.element.contains(component.get('[data-testid="screen"]').element)).toBe(true);
    expect(component.findComponent(WorkspaceSidebar).props('currentNodeId')).toBe('page-1');
  });
});

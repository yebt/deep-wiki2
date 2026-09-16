import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import WorkspaceFrame from './WorkspaceFrame.vue';
import WorkspaceSidebar from './WorkspaceSidebar.vue';

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
});

/**
 * The workspace frame around a screen: the sidebar, the skip link past
 * it, and the room for the content pane. What this holds is the
 * *placement* and the *plumbing* — that the frame stands on the workspace
 * the person is in and hands the sidebar the node the screen is about.
 * That the frame is mounted once per session rather than once per route
 * is the layout's claim (`layouts/workspace.test.ts`), and that the tree
 * keeps its scroll across a navigation is a measurement only a browser
 * can make: `e2e/frame.spec.ts`, "the sidebar survives a navigation".
 */
function mount(nodeId: string | null = null, route = '/') {
  useCurrentWorkspace().enter('ws-1');
  return mountSuspended(
    defineComponent({
      name: 'FrameInApp',
      setup: () => () => h(UApp, null, { default: () => h(WorkspaceFrame, { nodeId }, { default: () => h('p', { 'data-testid': 'pane' }, 'the pane') }) }),
    }),
    { route },
  );
}

describe('WorkspaceFrame', () => {
  test('stands on the workspace the person is in, and hands the sidebar the node the screen is about', async () => {
    const component = await mount('page-1');

    const sidebar = component.findComponent(WorkspaceSidebar);
    expect(sidebar.props('workspaceId')).toBe('ws-1');
    expect(sidebar.props('currentNodeId')).toBe('page-1');
  });

  test('hands the sidebar the region the route asks for: the tree by default, management on a management screen', async () => {
    const dashboard = await mount(null, '/workspaces/ws-1');
    expect(dashboard.findComponent(WorkspaceSidebar).props('mode')).toBe('tree');

    const members = await mount(null, '/workspaces/ws-1/members');
    expect(members.findComponent(WorkspaceSidebar).props('mode')).toBe('management');
  });

  test('the first tab stop skips past the sidebar to the content bar, and the pane renders after the sidebar', async () => {
    const component = await mount();

    const focusables = component.findAll('a, button, [tabindex="0"]');
    expect(focusables[0]!.text()).toBe('Skip to content');
    expect(focusables[0]!.attributes('href')).toBe('#content-bar');

    const html = component.element.innerHTML;
    expect(html.indexOf('the pane')).toBeGreaterThan(html.indexOf('aria-label="Workspace"'));
  });
});

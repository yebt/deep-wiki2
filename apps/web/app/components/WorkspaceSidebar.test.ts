import { UApp, UDashboardGroup } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import NavigationTree from './NavigationTree.vue';
import WorkspaceSidebar from './WorkspaceSidebar.vue';
import WorkspaceSwitcher from './WorkspaceSwitcher.vue';

/**
 * The left pane of the workspace frame: switcher at the top, tree in the
 * middle, doors at the bottom. What this holds is the *placement* — which
 * control stands where, and which are present without a workspace — not
 * the tree's or the switcher's own behaviour, which their own suites own.
 */
const { useWorkspaceTreeMock, useWorkspaceDirectoryMock } = vi.hoisted(() => ({
  useWorkspaceTreeMock: vi.fn(),
  useWorkspaceDirectoryMock: vi.fn(),
}));
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);

function mockCollaborators() {
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
}

/** `UDashboardSidebar` reads its context from `UDashboardGroup`, so the pane is mounted inside one, as it ships. */
function mount(props: { workspaceId: string | null; currentNodeId?: string | null }) {
  mockCollaborators();
  return mountSuspended(
    defineComponent({
      name: 'SidebarInApp',
      setup: () => () => h(UApp, null, { default: () => h(UDashboardGroup, { unit: 'rem' }, { default: () => h(WorkspaceSidebar, props) }) }),
    }),
  );
}

describe('WorkspaceSidebar', () => {
  test('inside a workspace: the switcher above, the tree in the middle, Members and the operator door and the theme toggle below', async () => {
    const component = await mount({ workspaceId: 'ws-1', currentNodeId: 'page-1' });

    const switcher = component.findComponent(WorkspaceSwitcher);
    const tree = component.findComponent(NavigationTree);
    expect(switcher.exists()).toBe(true);
    expect(tree.exists()).toBe(true);
    expect(tree.props('workspaceId')).toBe('ws-1');
    expect(tree.props('currentNodeId')).toBe('page-1');

    const members = component.get('a[href="/workspaces/ws-1/members"]');
    expect(members.text()).toContain('Members');
    expect(component.get('a[href="/admin/registration"]').attributes('aria-label')).toBe('Registration settings');
    expect(component.get('button[aria-label="Toggle color theme"]').attributes('type')).toBe('button');

    // Reading order is top to bottom: switcher, tree, doors.
    const all = component.element.innerHTML;
    expect(all.indexOf('Contents')).toBeGreaterThan(all.indexOf('Acme'));
    expect(all.indexOf('Members')).toBeGreaterThan(all.indexOf('Contents'));
  });

  test('with no workspace yet: no tree and no Members door, but a way to the workspace list', async () => {
    const component = await mount({ workspaceId: null });

    expect(component.findComponent(NavigationTree).exists()).toBe(false);
    expect(component.find('a[href^="/workspaces/"][href$="/members"]').exists()).toBe(false);
    expect(component.get('[data-testid="sidebar-no-workspace"]').text()).toMatch(/pick a workspace/i);
    expect(component.get('a[href="/workspaces"]').text()).toContain('All workspaces');
    // The operator door and the theme toggle do not depend on a workspace.
    expect(component.find('a[href="/admin/registration"]').exists()).toBe(true);
  });
});

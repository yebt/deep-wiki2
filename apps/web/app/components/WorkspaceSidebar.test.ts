import { UApp, UDashboardGroup } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import ManagementSidebar from './ManagementSidebar.vue';
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

/** `UDashboardSidebar` reads its context from `UDashboardGroup`, so the pane is mounted inside one, as it ships — with the frame's own storage key, so the cookie asserted below is the one the product writes. */
function mount(props: { workspaceId: string | null; currentNodeId?: string | null; mode?: 'tree' | 'management' }) {
  mockCollaborators();
  useFocusMode().collapsed.value = false;
  return mountSuspended(
    defineComponent({
      name: 'SidebarInApp',
      setup: () => () =>
        h(UApp, null, {
          default: () => h(UDashboardGroup, { unit: 'rem', storage: 'cookie', storageKey: 'dw-frame' }, { default: () => h(WorkspaceSidebar, props) }),
        }),
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

  /*
   * Management mode: the tree steps out and everything that is management
   * steps in (`ManagementSidebar`), and the two footer doors it now holds
   * as sections — Members, Registration settings — step out of the footer
   * so each stands once. The switcher and the theme toggle stay: the person
   * is still in the workspace, and the pane keeps its shape.
   */
  test('in management mode: the switcher above, the management doors in the middle, and the footer keeps only the theme toggle', async () => {
    const component = await mount({ workspaceId: 'ws-1', mode: 'management' });

    expect(component.findComponent(WorkspaceSwitcher).exists()).toBe(true);
    expect(component.findComponent(NavigationTree).exists()).toBe(false);
    const management = component.findComponent(ManagementSidebar);
    expect(management.exists()).toBe(true);
    expect(management.props('workspaceId')).toBe('ws-1');

    // Each door once: the sections hold them, the footer no longer does.
    expect(component.findAll('a[href="/workspaces/ws-1/members"]')).toHaveLength(1);
    expect(component.findAll('a[href="/admin/registration"]')).toHaveLength(1);
    expect(component.find('a[aria-label="Registration settings"]').exists()).toBe(false);
    expect(component.get('button[aria-label="Toggle color theme"]').attributes('type')).toBe('button');
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

  /*
   * Focus mode. The sidebar is `collapsible` and bound to `useFocusMode`,
   * so the control in the content bar hides it — to nothing: the root is
   * hidden from `lg` up rather than narrowed to a rail, and the resize
   * handle is hidden with it, since a handle on nothing is a control
   * that does nothing (§6). Nuxt UI persists the collapse in the same cookie
   * as the width. That the pane actually vanishes and the article takes
   * the width is `e2e/frame.spec.ts`'s ("focus mode"); this holds the
   * binding and the cookie.
   */
  test('focus mode hides the pane rather than narrowing it, hides the resize handle with it, and persists beside the width', async () => {
    const component = await mount({ workspaceId: 'ws-1' });
    const root = component.get('[data-slot="root"][id]');
    expect(root.attributes('data-collapsed')).toBe('false');
    expect(root.classes()).toContain('lg:data-[collapsed=true]:hidden');
    expect(component.get('[role="separator"]').classes()).not.toContain('lg:hidden');

    useFocusMode().toggle();
    await nextTick();
    await nextTick();

    expect(component.get('[data-slot="root"][id]').attributes('data-collapsed')).toBe('true');
    expect(component.get('[role="separator"]').classes()).toContain('lg:hidden');
    expect(decodeURIComponent(document.cookie)).toMatch(/dw-frame-sidebar-workspace=\{[^}]*"collapsed":true/);
  });
});

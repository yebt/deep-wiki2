import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import WorkspaceSwitcher from './WorkspaceSwitcher.vue';

/**
 * The compact control at the top of the sidebar that names the workspace
 * the person is in and, rarely and deliberately, lets them leave for
 * another (apps/web/PRODUCT.md: "switching workspaces is rare and
 * deliberate"). It is a menu, not a list on screen: the room's name is
 * what is always visible, the doors are behind it.
 */
const { useWorkspaceDirectoryMock } = vi.hoisted(() => ({ useWorkspaceDirectoryMock: vi.fn() }));
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);

function mockDirectory(workspaces: { id: string; name: string; slug: string }[], status = 'success') {
  const ensure = vi.fn(async () => {});
  const list = ref(workspaces);
  useWorkspaceDirectoryMock.mockReturnValue({
    status: ref(status),
    workspaces: computed(() => list.value),
    ensure,
    refresh: vi.fn(async () => {}),
    nameOf: (id: string) => list.value.find((w) => w.id === id)?.name ?? null,
    slugOf: (id: string) => list.value.find((w) => w.id === id)?.slug ?? null,
    idOf: (slug: string) => list.value.find((w) => w.slug === slug)?.id ?? null,
  });
  return { ensure };
}

function mount(props: { workspaceId: string | null }) {
  return mountSuspended(
    defineComponent({
      name: 'SwitcherInApp',
      setup: () => () => h(UApp, null, { default: () => h(WorkspaceSwitcher, props) }),
    }),
  );
}

describe('WorkspaceSwitcher', () => {
  test('names the current workspace on its trigger and loads the directory to do so', async () => {
    const { ensure } = mockDirectory([
      { id: 'ws-1', name: 'Acme', slug: 'acme' },
      { id: 'ws-2', name: 'Beta', slug: 'beta' },
    ]);
    const component = await mount({ workspaceId: 'ws-1' });

    const trigger = component.get('button');
    expect(trigger.text()).toContain('Acme');
    expect(trigger.attributes('aria-haspopup')).toBe('menu');
    expect(ensure).toHaveBeenCalled();
  });

  test('with no workspace chosen, the trigger says so instead of showing a stale or empty name', async () => {
    mockDirectory([{ id: 'ws-1', name: 'Acme', slug: 'acme' }]);
    const component = await mount({ workspaceId: null });

    expect(component.get('button').text()).toMatch(/choose a workspace/i);
  });

  test('a workspace the directory does not name is shown by an honest placeholder, never another workspace’s name', async () => {
    mockDirectory([{ id: 'ws-1', name: 'Acme', slug: 'acme' }]);
    const component = await mount({ workspaceId: 'ws-unknown' });

    const text = component.get('button').text();
    expect(text).not.toContain('Acme');
    expect(text).toMatch(/workspace/i);
  });
});

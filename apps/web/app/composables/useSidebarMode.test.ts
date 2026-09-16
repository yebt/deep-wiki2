import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { useSidebarMode } from './useSidebarMode';

const { routeMock } = vi.hoisted(() => ({ routeMock: vi.fn() }));
mockNuxtImport('useRoute', () => routeMock);

/**
 * One mechanism decides which sidebar a screen inside the workspace frame
 * gets: `definePageMeta({ sidebar: 'management' })`. The frame reads it
 * from the route, so a navigation from the dashboard to the members
 * screen swaps the pane's region without either screen knowing the other.
 */
describe('useSidebarMode', () => {
  test('a screen that names no sidebar gets the tree — the room\'s furniture, always at hand', () => {
    routeMock.mockReturnValue(reactive({ meta: {} }));
    expect(useSidebarMode().value).toBe('tree');
  });

  test('a management screen names `management`, and the mode follows the route as it changes', () => {
    const route = reactive({ meta: { sidebar: 'management' } as { sidebar?: 'tree' | 'management' } });
    routeMock.mockReturnValue(route);
    const mode = useSidebarMode();
    expect(mode.value).toBe('management');

    route.meta = {};
    expect(mode.value).toBe('tree');
  });
});

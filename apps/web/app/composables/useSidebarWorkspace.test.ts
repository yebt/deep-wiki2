import { mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test } from 'vitest';
import { defineComponent, effectScope, h, nextTick, ref } from 'vue';
import { useNuxtApp, useState } from '#imports';
import { useSidebarWorkspace } from './useSidebarWorkspace';

const KEY = 'dw-frame-sidebar-workspace-rendered';

/**
 * The sidebar hydrates with the workspace the server rendered it with —
 * which on a first visit is none, since the screen enters the workspace
 * only after the sidebar has rendered — and stands on the live one once
 * mounted. See the composable's note for the mismatch this closes.
 */
describe('useSidebarWorkspace', () => {
  beforeEach(() => {
    delete (useNuxtApp().payload.state as Record<string, unknown>)[`$s${KEY}`];
  });

  test('before mount, renders the workspace the server rendered with, not the live one', () => {
    useState<string | null>(KEY, () => null); // what a first-visit server render serialised
    const live = ref<string | null>('ws-1');

    const scope = effectScope();
    const sidebar = scope.run(() => useSidebarWorkspace(live))!;

    expect(sidebar.value).toBeNull();
    scope.stop();
  });

  test('once mounted, stands on the live workspace', async () => {
    useState<string | null>(KEY, () => null);
    const live = ref<string | null>('ws-1');
    let sidebar!: ReturnType<typeof useSidebarWorkspace>;

    await mountSuspended(
      defineComponent({
        setup() {
          sidebar = useSidebarWorkspace(live);
          return () => h('div', sidebar.value ?? 'none');
        },
      }),
    );
    await nextTick();

    expect(sidebar.value).toBe('ws-1');
    live.value = 'ws-2';
    expect(sidebar.value).toBe('ws-2');
  });

  test('with nothing serialised, the live workspace is what the frame renders with from the start', () => {
    const live = ref<string | null>('ws-1');
    const scope = effectScope();
    const sidebar = scope.run(() => useSidebarWorkspace(live))!;

    expect(sidebar.value).toBe('ws-1');
    scope.stop();
  });
});

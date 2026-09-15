import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import { provideWorkspaceFrame, useWorkspaceFrame, type WorkspaceFrame } from './useWorkspaceFrame';

/**
 * The seam between the workspace layout and the screens inside it. The
 * layout mounts the frame once — sidebar, skip link — and provides this
 * context; a screen's `AppShell` reads it to learn two things: that a
 * frame already stands around it, so it renders only the content pane,
 * and where to write the node it is about, so the sidebar can mark the
 * row and the breadcrumb can walk to it.
 */
describe('useWorkspaceFrame', () => {
  test('a screen inside the layout reads the frame the layout provided, and writes its node into it', async () => {
    let seen: WorkspaceFrame | null | undefined;
    let provided: WorkspaceFrame | undefined;
    const Screen = defineComponent({
      setup() {
        seen = useWorkspaceFrame();
        seen?.setNodeId('page-1');
        return () => h('div');
      },
    });
    const Layout = defineComponent({
      setup() {
        provided = provideWorkspaceFrame();
        return () => h(Screen);
      },
    });

    await mountSuspended(Layout);

    expect(seen).toBe(provided);
    expect(provided!.nodeId.value).toBe('page-1');
  });

  test('a screen outside any layout reads nothing, so it knows to stand up its own frame', async () => {
    let seen: WorkspaceFrame | null | undefined;
    const Screen = defineComponent({
      setup() {
        seen = useWorkspaceFrame();
        return () => h('div');
      },
    });

    await mountSuspended(Screen);

    expect(seen).toBeNull();
  });
});

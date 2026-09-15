import type { InjectionKey } from 'vue';

export interface WorkspaceFrame {
  /** The node the screen inside the frame is about — marked in the tree, walked to by the breadcrumb. `null` for a screen about no node. */
  readonly nodeId: Readonly<Ref<string | null>>;
  readonly setNodeId: (nodeId: string | null) => void;
}

const KEY: InjectionKey<WorkspaceFrame> = Symbol('dw-workspace-frame');

/**
 * The seam between `layouts/workspace.vue` and the screens inside it.
 *
 * The layout mounts the workspace frame **once** — the sidebar with its
 * tree, the skip link — and the router swaps only the content pane
 * beneath it, so the tree keeps its scroll position and its DOM across
 * navigations (`e2e/frame.spec.ts` holds that; before the layout, every
 * route rebuilt the sidebar and the tree's scroll reset on each click).
 * What the frame cannot know on its own is which node the current screen
 * is about: the screen's `AppShell` learns it from its route or its
 * response and hands it here, and the sidebar marks the row.
 *
 * `provideWorkspaceFrame` is the layout's; `useWorkspaceFrame` is
 * `AppShell`'s, and its answering `null` is how a screen that has not
 * opted into the layout knows to stand up a frame of its own.
 */
export function provideWorkspaceFrame(): WorkspaceFrame {
  const nodeId = ref<string | null>(null);
  const frame: WorkspaceFrame = {
    nodeId: readonly(nodeId),
    setNodeId: (value) => {
      nodeId.value = value;
    },
  };
  provide(KEY, frame);
  return frame;
}

export function useWorkspaceFrame(): WorkspaceFrame | null {
  return inject(KEY, null);
}

export type TreeStatus = 'idle' | 'loading' | 'success' | 'forbidden' | 'not-found' | 'unauthenticated' | 'network-error';

export interface TreeNode {
  readonly id: string;
  readonly type: string;
  readonly slug: string;
  readonly title: string;
  readonly position: number;
  readonly children: readonly TreeNode[];
}

export type FetchTree = (workspaceId: string) => Promise<{ rootId: string; nodes: readonly TreeNode[] }>;
export type ReorderFetcher = (nodeId: string, newParentId: string, newIndex: number) => Promise<{ ok: boolean }>;

/** What `POST /nodes` answers — enough to draw the row without asking for the tree again. */
export interface CreatedNode {
  readonly id: string;
  readonly parentId: string;
  readonly type: string;
  readonly slug: string;
  readonly title: string;
  readonly position: number;
}

/** What `PATCH /nodes/:id` answers. */
export interface RenamedNode {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

export interface UseTreeDeps {
  readonly fetchTree?: FetchTree;
  readonly reorderFetcher?: ReorderFetcher;
}

export interface UseTreeResult {
  readonly status: Ref<TreeStatus>;
  readonly nodes: Ref<readonly TreeNode[]>;
  readonly rootId: Ref<string | null>;
  readonly message: Ref<string>;
  readonly load: () => Promise<void>;
  /**
   * Moves the node locally at once, then writes; a refusal puts the tree
   * back as it was and resolves `false`. The tree is never reloaded for a
   * reorder: the local move is the same arithmetic `reorderNode` does.
   */
  readonly reorder: (nodeId: string, newParentId: string, newIndex: number) => Promise<boolean>;
  /** Draws the node `POST /nodes` just created, under its parent, from the response alone. */
  readonly applyCreated: (created: CreatedNode) => void;
  /** Patches the node `PATCH /nodes/:id` just renamed, from the response alone. */
  readonly applyRenamed: (renamed: RenamedNode) => void;
}

/* ─── Local edits of a loaded tree ─────────────────────────────────────
 * Pure functions over the immutable node list: each returns a new tree
 * with one change, leaving every untouched branch the same object so Vue
 * re-renders only the rows that moved. Exported for their own tests and
 * for `useWorkspaceTree`, which mirrors the transport's state.
 */

/** `nodes` with the node `id` removed, wherever it was; `removed` is the node itself, or `null` when the tree does not hold it. */
function withoutNode(nodes: readonly TreeNode[], id: string): { nodes: readonly TreeNode[]; removed: TreeNode | null } {
  const at = nodes.findIndex((node) => node.id === id);
  if (at !== -1) {
    return { nodes: renumber([...nodes.slice(0, at), ...nodes.slice(at + 1)]), removed: nodes[at]! };
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const inner = withoutNode(node.children, id);
    if (inner.removed) {
      const next = [...nodes];
      next[index] = { ...node, children: inner.nodes };
      return { nodes: next, removed: inner.removed };
    }
  }
  return { nodes, removed: null };
}

/** `list` with `child` at `index`, clamped to the list as `reorderNode` clamps it. */
function insertAt(list: readonly TreeNode[], child: TreeNode, index: number): readonly TreeNode[] {
  const at = Math.max(0, Math.min(index, list.length));
  return renumber([...list.slice(0, at), child, ...list.slice(at)]);
}

/**
 * `nodes` with `child` inserted among the children of `parentId` — the
 * top level when `parentId` is the root. The same list back when the tree
 * does not hold the parent, so a caller can tell nothing was drawn.
 */
function withChildAt(nodes: readonly TreeNode[], parentId: string, rootId: string | null, child: TreeNode, index: number): readonly TreeNode[] {
  if (parentId === (rootId ?? '')) return insertAt(nodes, child, index);
  return mapNode(nodes, parentId, (parent) => ({ ...parent, children: insertAt(parent.children, child, index) }));
}

/** `nodes` with the node `id` replaced by what `patch` makes of it; the same list when the tree does not hold it. */
function mapNode(nodes: readonly TreeNode[], id: string, patch: (node: TreeNode) => TreeNode): readonly TreeNode[] {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.id === id) {
      const next = [...nodes];
      next[index] = patch(node);
      return next;
    }
    const children = mapNode(node.children, id, patch);
    if (children !== node.children) {
      const next = [...nodes];
      next[index] = { ...node, children };
      return next;
    }
  }
  return nodes;
}

/** Positions follow the order, as `reorderNode` rewrites them — so anything that sorts by `position` agrees with the list. */
function renumber(nodes: readonly TreeNode[]): readonly TreeNode[] {
  return nodes.map((node, position) => (node.position === position ? node : { ...node, position }));
}

/**
 * The move `PATCH /nodes/:id/position` makes, done to the local tree:
 * the node leaves its place, and `newIndex` counts among the new parent's
 * children *without* it, clamped to that list (`packages/db/src/nodes/
 * reorder.ts`). The same arithmetic on both sides is what lets the tree
 * draw the result before the server confirms it.
 */
export function moveNode(nodes: readonly TreeNode[], rootId: string | null, nodeId: string, newParentId: string, newIndex: number): readonly TreeNode[] {
  const { nodes: without, removed } = withoutNode(nodes, nodeId);
  if (!removed) return nodes;
  const moved = withChildAt(without, newParentId, rootId, removed, newIndex);
  // A destination the tree does not hold: leave the tree alone rather
  // than lose the row; the server's answer decides.
  return moved === without ? nodes : moved;
}

/** The node `POST /nodes` created, drawn where the server put it: at the end of its parent's list. */
export function insertCreatedNode(nodes: readonly TreeNode[], rootId: string | null, created: CreatedNode): readonly TreeNode[] {
  const child: TreeNode = { id: created.id, type: created.type, slug: created.slug, title: created.title, position: created.position, children: [] };
  return withChildAt(nodes, created.parentId, rootId, child, Number.MAX_SAFE_INTEGER);
}

/** The node `PATCH /nodes/:id` renamed, patched in place. */
export function renameTreeNode(nodes: readonly TreeNode[], renamed: RenamedNode): readonly TreeNode[] {
  return mapNode(nodes, renamed.id, (node) => ({ ...node, slug: renamed.slug, title: renamed.title }));
}

/**
 * `GET /workspaces/:id/tree` + `PATCH /nodes/:id/position`
 * (navigation-tree spec: "Tree Displays Only Readable Nodes", "Drag
 * Reorder Writes Back To Position", "Reordering Requires Write Or Manage
 * Permission"). The tree endpoint already filters through `can()`
 * server-side — this composable adds no client-side filtering — and a
 * reorder the server rejects (no write grant, cross-workspace target)
 * is undone locally, so a denied drag visibly snaps back rather than
 * looking like it silently succeeded.
 *
 * Writes are optimistic (2026-09-16). Until then a reorder awaited the
 * server and then reloaded the whole tree, so the dragged row snapped
 * back to where it started until both round trips had landed, and a
 * created or renamed row appeared on the second request rather than the
 * first. The local tree now changes first — the same arithmetic the
 * server does — and the request follows; only a refusal puts it back.
 */
export function useTree(workspaceId: string, deps: UseTreeDeps = {}): UseTreeResult {
  const config = useRuntimeConfig();
  const fetchTree: FetchTree =
    deps.fetchTree ?? ((ws) => $fetch(`${config.public.apiBaseUrl}/workspaces/${ws}/tree`, { credentials: 'include' }));
  const reorderFetcher: ReorderFetcher =
    deps.reorderFetcher ??
    ((nodeId, newParentId, newIndex) =>
      $fetch(`${config.public.apiBaseUrl}/nodes/${nodeId}/position`, {
        method: 'PATCH',
        credentials: 'include',
        body: { newParentId, newIndex },
      }));

  const status = ref<TreeStatus>('idle');
  const nodes = ref<readonly TreeNode[]>([]);
  const rootId = ref<string | null>(null);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      const result = await fetchTree(workspaceId);
      nodes.value = result.nodes;
      rootId.value = result.rootId;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      const code = httpStatusOf(error);
      // Signed out: the screen's next move is sign-in, not a retry
      // (`useSignInRedirect`), so this is never the network branch.
      if (code === 401) {
        status.value = 'unauthenticated';
        message.value = 'Your session has ended.';
        return;
      }
      if (code === 403) {
        status.value = 'forbidden';
        message.value = "You don't have access to this workspace's tree.";
      } else if (code === 404) {
        status.value = 'not-found';
        message.value = 'This workspace does not exist.';
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
      }
    }
  }

  async function reorder(nodeId: string, newParentId: string, newIndex: number): Promise<boolean> {
    const before = nodes.value;
    nodes.value = moveNode(before, rootId.value, nodeId, newParentId, newIndex);
    try {
      await reorderFetcher(nodeId, newParentId, newIndex);
      return true;
    } catch {
      // Back to exactly what was drawn before the drag — not a reload,
      // which would also lose any later local edit still in flight.
      nodes.value = before;
      return false;
    }
  }

  function applyCreated(created: CreatedNode): void {
    nodes.value = insertCreatedNode(nodes.value, rootId.value, created);
  }

  function applyRenamed(renamed: RenamedNode): void {
    nodes.value = renameTreeNode(nodes.value, renamed);
  }

  return { status, nodes, rootId, message, load, reorder, applyCreated, applyRenamed };
}

import { useTree, type CreatedNode, type RenamedNode, type TreeNode, type TreeStatus, type UseTreeDeps } from './useTree';

interface TreeRecord {
  status: TreeStatus;
  nodes: readonly TreeNode[];
  rootId: string | null;
  message: string;
}

const EMPTY: TreeRecord = { status: 'idle', nodes: [], rootId: null, message: '' };

export interface UseWorkspaceTreeResult {
  readonly status: ComputedRef<TreeStatus>;
  readonly nodes: ComputedRef<readonly TreeNode[]>;
  readonly rootId: ComputedRef<string | null>;
  readonly message: ComputedRef<string>;
  /** Containers the person folded; everything else is open. */
  readonly collapsedIds: ComputedRef<ReadonlySet<string>>;
  /** The row the person picked — what the toolbar acts on. */
  readonly selectedId: Ref<string | null>;
  readonly load: () => Promise<void>;
  readonly reorder: (nodeId: string, newParentId: string, newIndex: number) => Promise<boolean>;
  readonly applyCreated: (created: CreatedNode) => void;
  readonly applyRenamed: (renamed: RenamedNode) => void;
  readonly toggleCollapsed: (nodeId: string) => void;
  /** Unfold every ancestor of a node so its row is on screen. */
  readonly reveal: (nodeId: string) => void;
  /** The node and its ancestors, outermost first; empty for an id the tree does not hold. */
  readonly pathTo: (nodeId: string) => readonly TreeNode[];
}

/**
 * The sidebar's tree, kept across screens.
 *
 * Every route renders its own `AppShell`, so a tree held in a component
 * ref would be refetched and re-skeletoned on every navigation inside the
 * workspace — the opposite of "the tree is the room's furniture, always at
 * hand, never a destination" (apps/web/PRODUCT.md). The loaded nodes, the
 * fold state and the selection therefore live in `useState`, keyed by
 * workspace, and a second mount reads them back before it refreshes.
 *
 * `useTree` stays the transport — the endpoint, the error mapping, the
 * optimistic reorder and the local create/rename — and this composable
 * only decides where the answer lives: the transport's refs are mirrored
 * into the shared record the moment they change, so a row moved before
 * the server has answered is on screen at once (2026-09-16; before, the
 * record was written only once a request had settled). A `null` workspace
 * has nothing to load and is `idle`, never an error: the shell renders
 * while a screen is still finding out which workspace it is in.
 */
export function useWorkspaceTree(workspaceId: MaybeRefOrGetter<string | null>, deps: UseTreeDeps = {}): UseWorkspaceTreeResult {
  const records = useState<Record<string, TreeRecord>>('dw-workspace-trees', () => ({}));
  const folds = useState<Record<string, string[]>>('dw-workspace-tree-folds', () => ({}));
  const selections = useState<Record<string, string | null>>('dw-workspace-tree-selection', () => ({}));

  const id = computed(() => toValue(workspaceId));
  const record = computed<TreeRecord>(() => (id.value ? (records.value[id.value] ?? EMPTY) : EMPTY));

  /**
   * One transport per workspace id, created on demand. It starts from
   * whatever the record already holds — a second mount must edit the tree
   * on screen, not an empty one — and from then on the record follows it:
   * every change to the transport's refs is written through at once.
   */
  const transports = new Map<string, ReturnType<typeof useTree>>();
  function transport(): ReturnType<typeof useTree> | null {
    const workspaceId = id.value;
    if (!workspaceId) return null;
    let t = transports.get(workspaceId);
    if (!t) {
      t = useTree(workspaceId, deps);
      const current = records.value[workspaceId] ?? EMPTY;
      t.status.value = current.status;
      t.nodes.value = current.nodes;
      t.rootId.value = current.rootId;
      t.message.value = current.message;
      watch(
        [t.status, t.nodes, t.rootId, t.message],
        ([status, nodes, rootId, message]) => {
          // Only the first load shows a skeleton; a refresh of a tree
          // already on screen keeps the loaded rows in place while the
          // answer arrives, so `loading` is not written over `success`.
          const shown = records.value[workspaceId] ?? EMPTY;
          if (status === 'loading' && shown.status === 'success') return;
          records.value = { ...records.value, [workspaceId]: { status, nodes, rootId, message } };
        },
        { flush: 'sync' },
      );
      transports.set(workspaceId, t);
    }
    return t;
  }

  async function load(): Promise<void> {
    await transport()?.load();
  }

  async function reorder(nodeId: string, newParentId: string, newIndex: number): Promise<boolean> {
    const t = transport();
    if (!t) return false;
    return t.reorder(nodeId, newParentId, newIndex);
  }

  function applyCreated(created: CreatedNode): void {
    transport()?.applyCreated(created);
  }

  function applyRenamed(renamed: RenamedNode): void {
    transport()?.applyRenamed(renamed);
  }

  const collapsedIds = computed<ReadonlySet<string>>(() => new Set(id.value ? (folds.value[id.value] ?? []) : []));

  function writeFolds(next: ReadonlySet<string>): void {
    if (!id.value) return;
    folds.value = { ...folds.value, [id.value]: [...next] };
  }

  function toggleCollapsed(nodeId: string): void {
    const next = new Set(collapsedIds.value);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    writeFolds(next);
  }

  function pathTo(nodeId: string): readonly TreeNode[] {
    const walk = (list: readonly TreeNode[], trail: TreeNode[]): TreeNode[] | null => {
      for (const node of list) {
        if (node.id === nodeId) return [...trail, node];
        const found = walk(node.children, [...trail, node]);
        if (found) return found;
      }
      return null;
    };
    return walk(record.value.nodes, []) ?? [];
  }

  function reveal(nodeId: string): void {
    const ancestors = pathTo(nodeId).slice(0, -1);
    if (ancestors.length === 0) return;
    const next = new Set(collapsedIds.value);
    for (const ancestor of ancestors) next.delete(ancestor.id);
    writeFolds(next);
  }

  const selectedId = computed<string | null>({
    get: () => (id.value ? (selections.value[id.value] ?? null) : null),
    set: (value) => {
      if (!id.value) return;
      selections.value = { ...selections.value, [id.value]: value };
    },
  });

  return {
    status: computed(() => record.value.status),
    nodes: computed(() => record.value.nodes),
    rootId: computed(() => record.value.rootId),
    message: computed(() => record.value.message),
    collapsedIds,
    selectedId,
    load,
    reorder,
    applyCreated,
    applyRenamed,
    toggleCollapsed,
    reveal,
    pathTo,
  };
}

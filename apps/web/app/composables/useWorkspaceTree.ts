import { useTree, type TreeNode, type TreeStatus, type UseTreeDeps } from './useTree';

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
 * reorder that reloads on success — and this composable only decides
 * where the answer lives. A `null` workspace has nothing to load and is
 * `idle`, never an error: the shell renders while a screen is still
 * finding out which workspace it is in.
 */
export function useWorkspaceTree(workspaceId: MaybeRefOrGetter<string | null>, deps: UseTreeDeps = {}): UseWorkspaceTreeResult {
  const records = useState<Record<string, TreeRecord>>('dw-workspace-trees', () => ({}));
  const folds = useState<Record<string, string[]>>('dw-workspace-tree-folds', () => ({}));
  const selections = useState<Record<string, string | null>>('dw-workspace-tree-selection', () => ({}));

  const id = computed(() => toValue(workspaceId));
  const record = computed<TreeRecord>(() => (id.value ? (records.value[id.value] ?? EMPTY) : EMPTY));

  function write(patch: Partial<TreeRecord>): void {
    if (!id.value) return;
    records.value = { ...records.value, [id.value]: { ...record.value, ...patch } };
  }

  /** One transport per workspace id, created on demand and synced into the shared record. */
  const transports = new Map<string, ReturnType<typeof useTree>>();
  function transport(): ReturnType<typeof useTree> | null {
    if (!id.value) return null;
    let t = transports.get(id.value);
    if (!t) {
      t = useTree(id.value, deps);
      transports.set(id.value, t);
    }
    return t;
  }

  async function sync(t: ReturnType<typeof useTree>, run: () => Promise<void>): Promise<void> {
    // Only the first load shows a skeleton; a refresh of a tree already on
    // screen keeps the loaded rows in place while the answer arrives.
    if (record.value.status !== 'success') write({ status: 'loading' });
    await run();
    write({ status: t.status.value, nodes: t.nodes.value, rootId: t.rootId.value, message: t.message.value });
  }

  async function load(): Promise<void> {
    const t = transport();
    if (!t) return;
    await sync(t, () => t.load());
  }

  async function reorder(nodeId: string, newParentId: string, newIndex: number): Promise<boolean> {
    const t = transport();
    if (!t) return false;
    let ok = false;
    await sync(t, async () => {
      ok = await t.reorder(nodeId, newParentId, newIndex);
      // A refused reorder leaves the transport's own state untouched — and
      // with it, the record's — which is what makes a denied drag snap back.
      if (!ok) {
        t.nodes.value = record.value.nodes;
        t.rootId.value = record.value.rootId;
        t.status.value = record.value.status;
      }
    });
    return ok;
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
    toggleCollapsed,
    reveal,
    pathTo,
  };
}

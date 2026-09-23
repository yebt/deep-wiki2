import type { TreeNode } from './useTree';

/**
 * The navigation tree's filter — VS Code's explorer filter, for a tree
 * of shelves, books, chapters and pages.
 *
 * ── The pure part ───────────────────────────────────────────────────────
 *
 * `filterTree()` prunes a tree to the rows whose title contains the query
 * (case-insensitive) **and every ancestor of such a row**, in the tree's
 * own order. An ancestor is kept, not matched: the count announced to
 * the person is the matches alone, since "3 matches" that turn out to be
 * one page and its shelf and book is a count that lies. A container that
 * matches keeps its whole subtree, so what sits under a hit is still
 * reachable — filtering "Handbook" and finding an empty book would read
 * as the book having no pages.
 *
 * ── The fold bookkeeping ────────────────────────────────────────────────
 *
 * A match has to be *seen*, so its ancestors are open while the filter is
 * active whatever the person had folded. The person's folds are never
 * written to for that: while a query is active the tree reads a
 * separate, per-query fold set that starts empty, and a fold made during
 * the filter lands there. Clearing the query switches the tree back to
 * the person's own set, which was never touched — so "restore the folds
 * on clear" holds by construction rather than by a snapshot that has to
 * be put back at the right moment.
 */

export interface TreeFilterResult {
  /** The pruned tree: matches, their ancestors, and everything under a matching container. */
  readonly nodes: readonly TreeNode[];
  /** The rows whose own title matched — ancestors kept for the road are not in here. */
  readonly matchIds: ReadonlySet<string>;
  readonly matchCount: number;
}

export function filterTree(nodes: readonly TreeNode[], query: string): TreeFilterResult {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return { nodes, matchIds: new Set(), matchCount: 0 };

  const matchIds = new Set<string>();

  const prune = (list: readonly TreeNode[]): TreeNode[] => {
    const kept: TreeNode[] = [];
    for (const node of list) {
      const matches = node.title.toLowerCase().includes(needle);
      if (matches) {
        matchIds.add(node.id);
        // A matching container keeps its subtree whole — but the matches
        // inside it still count, so walk it for the ids.
        markMatches(node.children);
        kept.push(node);
        continue;
      }
      const children = prune(node.children);
      if (children.length > 0) kept.push({ ...node, children });
    }
    return kept;
  };

  const markMatches = (list: readonly TreeNode[]): void => {
    for (const node of list) {
      if (node.title.toLowerCase().includes(needle)) matchIds.add(node.id);
      markMatches(node.children);
    }
  };

  const pruned = prune(nodes);
  return { nodes: pruned, matchIds, matchCount: matchIds.size };
}

export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

/** A title split around the first occurrence of the query, for a `<mark>` — in the title's own casing. */
export function highlightSegments(title: string, query: string): readonly HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [{ text: title, match: false }];
  const at = title.toLowerCase().indexOf(needle);
  if (at === -1) return [{ text: title, match: false }];
  const segments: HighlightSegment[] = [];
  if (at > 0) segments.push({ text: title.slice(0, at), match: false });
  segments.push({ text: title.slice(at, at + needle.length), match: true });
  if (at + needle.length < title.length) segments.push({ text: title.slice(at + needle.length), match: false });
  return segments;
}

export interface UseTreeFilterResult {
  /** Whether the filter box is on screen. */
  readonly open: Ref<boolean>;
  readonly query: Ref<string>;
  /** Open with a non-blank query: the tree shown is the pruned one. */
  readonly active: ComputedRef<boolean>;
  readonly shownNodes: ComputedRef<readonly TreeNode[]>;
  readonly matchIds: ComputedRef<ReadonlySet<string>>;
  readonly matchCount: ComputedRef<number>;
  /** The folds the tree draws: the person's own, or the per-query set while filtering. */
  readonly effectiveCollapsedIds: ComputedRef<ReadonlySet<string>>;
  /** Folds into whichever set is current. */
  readonly toggleCollapsed: (nodeId: string) => void;
  /** Every row the tree is currently showing that has something under it — what "Collapse all" acts on. */
  readonly collapsibleIds: ComputedRef<readonly string[]>;
  /** At least one of those is open, so the control has something to do (docs/UI-CHECKLIST.md §3, §6). */
  readonly canCollapseAll: ComputedRef<boolean>;
  /** Folds all of them, into whichever set is current — the person's own, or the per-query one. */
  readonly collapseAll: () => void;
  /** For the live region: the count, in words, or nothing while inactive. */
  readonly announcement: ComputedRef<string>;
  readonly show: () => void;
  /** Clears the query and hides the box. */
  readonly hide: () => void;
  /** Clears the query and keeps the box. */
  readonly clear: () => void;
}

export function useTreeFilter(
  nodes: MaybeRefOrGetter<readonly TreeNode[]>,
  collapsedIds: MaybeRefOrGetter<ReadonlySet<string>>,
  toggleUserCollapsed: (nodeId: string) => void,
  collapseAllUser: (nodeIds: readonly string[]) => void,
): UseTreeFilterResult {
  const open = ref(false);
  const query = ref('');
  const filterFolds = ref<ReadonlySet<string>>(new Set());

  const active = computed(() => open.value && query.value.trim().length > 0);
  const result = computed<TreeFilterResult>(() =>
    active.value ? filterTree(toValue(nodes), query.value) : { nodes: toValue(nodes), matchIds: new Set(), matchCount: 0 },
  );

  // Every new query starts fully expanded: a fold made against the last
  // query was about rows that may not even be shown now.
  watch(query, () => {
    filterFolds.value = new Set();
  });

  const effectiveCollapsedIds = computed<ReadonlySet<string>>(() => (active.value ? filterFolds.value : toValue(collapsedIds)));

  function toggleCollapsed(nodeId: string): void {
    if (!active.value) {
      toggleUserCollapsed(nodeId);
      return;
    }
    const next = new Set(filterFolds.value);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    filterFolds.value = next;
  }

  /**
   * The containers of the tree *as shown*: while a filter is active the
   * pruned tree is what the person is looking at, and collapsing rows that
   * are not on screen would fold things they never saw.
   */
  const collapsibleIds = computed<readonly string[]>(() => {
    const out: string[] = [];
    const walk = (list: readonly TreeNode[]): void => {
      for (const node of list) {
        if (node.children.length === 0) continue;
        out.push(node.id);
        walk(node.children);
      }
    };
    walk(result.value.nodes);
    return out;
  });

  const canCollapseAll = computed(() => collapsibleIds.value.some((id) => !effectiveCollapsedIds.value.has(id)));

  function collapseAll(): void {
    const ids = collapsibleIds.value;
    if (ids.length === 0) return;
    if (!active.value) {
      collapseAllUser(ids);
      return;
    }
    filterFolds.value = new Set([...filterFolds.value, ...ids]);
  }

  const announcement = computed(() => {
    if (!active.value) return '';
    const shown = query.value.trim();
    const count = result.value.matchCount;
    if (count === 0) return `No matches for “${shown}”.`;
    return `${count} ${count === 1 ? 'match' : 'matches'} for “${shown}”.`;
  });

  function show(): void {
    open.value = true;
  }

  function clear(): void {
    query.value = '';
  }

  function hide(): void {
    query.value = '';
    open.value = false;
  }

  return {
    open,
    query,
    active,
    shownNodes: computed(() => result.value.nodes),
    matchIds: computed(() => result.value.matchIds),
    matchCount: computed(() => result.value.matchCount),
    effectiveCollapsedIds,
    toggleCollapsed,
    collapsibleIds,
    canCollapseAll,
    collapseAll,
    announcement,
    show,
    hide,
    clear,
  };
}

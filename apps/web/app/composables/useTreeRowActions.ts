import { legalChildTypes, type NodeType } from '@deep-wiki/contracts';
import type { TreeNode } from './useTree';
import { bookHistoryUrl, pageHistoryUrl, pageUrl } from '~/utils/routes';

/**
 * What a row of the navigation tree can have done to it — the item set
 * behind the row's context menu, derived rather than listed.
 *
 * ── One table, read backwards ───────────────────────────────────────────
 *
 * "New <child>…" is `legalChildTypes()` over the row's type: the inverse
 * of the one `LEGAL_PARENT_TYPES` table in `packages/core`, reached
 * through `@deep-wiki/contracts` exactly as the toolbar reaches it. A
 * page offers nothing to create because the table gives a page no
 * children; nobody wrote that down here, and nobody may — a second copy
 * is docs/TODO.md's own recurring defect, and `single-source.ts` fails
 * the build on one.
 *
 * ── Unavailable stays in the menu, with a reason ────────────────────────
 *
 * An action a row cannot take *right now* is still offered — disabled,
 * with the reason as its description — rather than removed, so the menu
 * reads the same on every row and a person learns why rather than
 * wondering where the item went (docs/UI-CHECKLIST.md §3 "Disabled" and
 * §5: `aria-disabled`, never the attribute, and the reason visible, not
 * behind a hover). What is left out entirely is what the row's *type*
 * can never do: a shelf has no address to open and no history to show,
 * so those two are absent on a shelf rather than permanently disabled.
 * "Copy link" is the one exception — on every row, because a person
 * reaches for it before knowing which rows have an address — and says
 * plainly that only a page has one today.
 *
 * ── Names that survive leaving the row ──────────────────────────────────
 *
 * The history item is "Page history" on a page and "Book history" on a
 * book, never a bare "History": a screen-reader user hears the menu
 * item, not the row it hangs off, so the name has to say what it is the
 * history of on its own (docs/UI-CHECKLIST.md §5). The visible label is
 * the accessible name — one set of words, not a label and a hidden
 * longer one (§4.3).
 *
 * ── What is not here ────────────────────────────────────────────────────
 *
 * No permission is consulted, because none reaches the client: the tree
 * endpoint hands over ids, types and titles and nothing about what the
 * caller may do with them (docs/TODO.md Open Questions). A rename or a
 * move a `read`-only member asks for is refused by the server and shown
 * as the toolbar already shows it — the same dialog, the same sentence.
 * And no delete, on purpose: three open questions in docs/TODO.md come
 * first.
 */
export type TreeRowActionKind = 'create' | 'rename' | 'move-up' | 'move-down' | 'open' | 'history' | 'copy-link';

export interface TreeRowAction {
  readonly kind: TreeRowActionKind;
  readonly label: string;
  readonly icon: string;
  readonly disabled: boolean;
  /** Why the action is unavailable right now; present exactly when `disabled`. */
  readonly reason?: string;
  /** For `create`: the type the item would create under this row. */
  readonly childType?: NodeType;
  /** For `open` and `history`: where the item goes. */
  readonly to?: string;
}

export interface TreeRowActionContext {
  /** The row's position among its siblings. */
  readonly index: number;
  readonly siblingCount: number;
  /** The workspace the row belongs to, by the slug its destinations' addresses carry. */
  readonly workspaceSlug: string;
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  workspace: 'Workspace',
  shelf: 'Shelf',
  book: 'Book',
  chapter: 'Chapter',
  page: 'Page',
};

/** Groups, in menu order: create · rename and move · destinations · copy. Empty groups are dropped. */
export function treeRowActions(node: TreeNode, ctx: TreeRowActionContext): readonly (readonly TreeRowAction[])[] {
  const type = node.type as NodeType;

  const creates: TreeRowAction[] = legalChildTypes(type).map((childType) => ({
    kind: 'create',
    label: `New ${NODE_TYPE_LABELS[childType].toLowerCase()}…`,
    icon: 'i-lucide-plus',
    disabled: false,
    childType,
  }));

  const first = ctx.index <= 0;
  const last = ctx.index >= ctx.siblingCount - 1;
  const edits: TreeRowAction[] = [
    { kind: 'rename', label: 'Rename…', icon: 'i-lucide-pencil-line', disabled: false },
    {
      kind: 'move-up',
      label: 'Move up',
      icon: 'i-lucide-arrow-up',
      disabled: first,
      ...(first ? { reason: 'Already first among its siblings.' } : {}),
    },
    {
      kind: 'move-down',
      label: 'Move down',
      icon: 'i-lucide-arrow-down',
      disabled: last,
      ...(last ? { reason: 'Already last among its siblings.' } : {}),
    },
  ];

  const destinations: TreeRowAction[] = [];
  if (type === 'page') {
    destinations.push({ kind: 'open', label: 'Open', icon: 'i-lucide-arrow-right', disabled: false, to: pageUrl(ctx.workspaceSlug, node.id) });
    destinations.push({ kind: 'history', label: 'Page history', icon: 'i-lucide-history', disabled: false, to: pageHistoryUrl(ctx.workspaceSlug, node.id) });
  } else if (type === 'book') {
    destinations.push({ kind: 'history', label: 'Book history', icon: 'i-lucide-history', disabled: false, to: bookHistoryUrl(ctx.workspaceSlug, node.id) });
  }

  const copy: TreeRowAction =
    type === 'page'
      ? { kind: 'copy-link', label: 'Copy link', icon: 'i-lucide-link', disabled: false }
      : { kind: 'copy-link', label: 'Copy link', icon: 'i-lucide-link', disabled: true, reason: 'Only a page has an address to copy yet.' };

  return [creates, edits, destinations, [copy]].filter((group) => group.length > 0);
}

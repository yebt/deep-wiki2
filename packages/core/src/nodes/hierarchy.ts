/**
 * Which node type may parent which (docs/SPECS.md §3.1):
 * Workspace -> Shelf -> Book -> {Chapter -> Page, Page}.
 *
 * ── Why this lives in `packages/core` ──────────────────────────────────
 *
 * It was written down twice before it was written down once. `move.ts`
 * and `reorder.ts` each carried a private `LEGAL_PARENT_TYPES` literal,
 * character-identical, with nothing in the repository comparing them —
 * the recurring defect docs/TODO.md has now recorded five times. A third
 * copy was about to appear the moment creation needed the same table, and
 * a fourth the moment a client wanted to offer a "what can I create
 * here?" menu.
 *
 * `packages/core` is the only package every consumer can already reach:
 * `packages/db` moves and creates nodes, `packages/contracts` re-exports
 * the table so `apps/web` can read it without a second dependency, and
 * `apps/api` refuses illegal requests with the error declared here. One
 * fact, four consumers, and `packages/db/src/nodes/single-source.test.ts`
 * fails the build if anyone declares a fifth.
 *
 * `legalChildTypes()` is deliberately *derived* rather than listed: the
 * inverse of a table is not a new fact, and a listed inverse is exactly
 * how two copies drift.
 */
export type NodeType = 'workspace' | 'shelf' | 'book' | 'chapter' | 'page';

/** Root-first, so a derived list reads in the order the tree nests. */
export const NODE_TYPES: readonly NodeType[] = ['workspace', 'shelf', 'book', 'chapter', 'page'];

export const LEGAL_PARENT_TYPES: Record<NodeType, readonly NodeType[]> = {
  workspace: [],
  shelf: ['workspace'],
  book: ['shelf'],
  chapter: ['book'],
  page: ['book', 'chapter'],
};

export function isLegalParentType(childType: NodeType, parentType: NodeType): boolean {
  return LEGAL_PARENT_TYPES[childType].includes(parentType);
}

/** The table read the other way round — never a second list. */
export function legalChildTypes(parentType: NodeType): NodeType[] {
  return NODE_TYPES.filter((child) => isLegalParentType(child, parentType));
}

/**
 * Thrown by every operation that would put a node under an illegal
 * parent — a move, a reorder that reparents, or a creation. One error
 * class, because it is one rule; the message names both types so the
 * refusal can be shown to the person who asked for it rather than
 * flattened into "invalid request".
 */
export class IllegalParentTypeError extends Error {
  readonly childType: NodeType;
  readonly parentType: NodeType;

  constructor(childType: NodeType, parentType: NodeType) {
    super(`a "${childType}" node cannot be parented under a "${parentType}" node`);
    this.name = 'IllegalParentTypeError';
    this.childType = childType;
    this.parentType = parentType;
  }
}

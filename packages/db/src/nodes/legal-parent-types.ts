/**
 * The one door `packages/db` uses onto the node hierarchy
 * (`packages/core/src/nodes/hierarchy.ts`).
 *
 * `move.ts`, `reorder.ts` and `create.ts` all reject an illegal parent,
 * and before this module existed two of the three carried their own copy
 * of the table. They now share this one function, and
 * `single-source.test.ts` compares the object it returns against core's
 * export by identity — so a fourth copy fails a test rather than drifting
 * quietly.
 */
import { IllegalParentTypeError, isLegalParentType, LEGAL_PARENT_TYPES, type NodeType } from '@deep-wiki/core';

export type { NodeType };
export { IllegalParentTypeError };

/** Exposed so `single-source.test.ts` can prove the writers read core's table and not a clone. */
export function legalParentTypesUsedBy(): Record<NodeType, readonly NodeType[]> {
  return LEGAL_PARENT_TYPES;
}

/**
 * The single refusal point. Every operation that attaches a node to a
 * parent — create, move, reorder-with-reparent — goes through here, so
 * "a book's parent is a shelf" is enforced by one comparison against one
 * table.
 */
export function assertLegalParent(childType: NodeType, parentType: NodeType): void {
  if (!isLegalParentType(childType, parentType)) {
    throw new IllegalParentTypeError(childType, parentType);
  }
}

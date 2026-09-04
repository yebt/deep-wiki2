import type { Action } from './types';

/**
 * The action lattice, least to most privileged. `allow(X)` covers actions
 * at or below X's rank; `deny(X)` covers actions at or above it. Denying
 * `read` must deny everything else too, because nothing is possible
 * without read; allowing `manage` implies every lesser action is also
 * allowed. See design.md D9.
 */
const ACTION_ORDER: readonly Action[] = ['read', 'comment', 'write', 'manage'];

function rankOf(action: Action): number {
  return ACTION_ORDER.indexOf(action);
}

/** Every action whose rank is <= the requested action's rank. */
export function impliedAllowActions(requested: Action): readonly Action[] {
  const requestedRank = rankOf(requested);
  return ACTION_ORDER.filter((action) => rankOf(action) <= requestedRank);
}

/** Every action whose rank is >= the requested action's rank. */
export function impliedDenyActions(requested: Action): readonly Action[] {
  const requestedRank = rankOf(requested);
  return ACTION_ORDER.filter((action) => rankOf(action) >= requestedRank);
}

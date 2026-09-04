import { decide } from './decide';
import type { GrantLookup, GrantQuery } from './types';

/**
 * The single decision point for authorisation. Gathers candidate grants
 * through the `GrantLookup` port, then folds them with the pure
 * `decide()` rule. Super Root does not call this for instance-level
 * operations — see `canOperateInstance()` (design.md D11).
 */
export async function can(lookup: GrantLookup, query: GrantQuery): Promise<boolean> {
  const grants = await lookup(query);
  return decide(grants) === 'allow';
}

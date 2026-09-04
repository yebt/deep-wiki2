import type { Effect, ResolvedGrant } from './types';

/**
 * The single precedence rule (design.md D7/D8): total over any grant set,
 * no grants -> deny, smallest depth wins, and a deny at the winning depth
 * beats an allow at that same depth regardless of which subject carried
 * it. SQL supplies the candidate rows with no ORDER BY or CASE of its own,
 * so this fold is the only place the rule is expressed.
 */
export function decide(grants: readonly ResolvedGrant[]): Effect {
  if (grants.length === 0) {
    return 'deny';
  }

  const minDepth = Math.min(...grants.map((grant) => grant.depth));
  const atMinDepth = grants.filter((grant) => grant.depth === minDepth);

  return atMinDepth.some((grant) => grant.effect === 'deny') ? 'deny' : 'allow';
}

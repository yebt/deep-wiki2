import { decide } from './decide';
import type { Effect, ResolvedGrant } from './types';

/**
 * Folds each group's grant set exactly as `decide()` folds one (design.md
 * D17 — Phase 1's D7, "SQL gathers, decide() decides", preserved verbatim
 * for set-shaped list endpoints). SQL supplies `groupsByOrigin` already
 * grouped by candidate origin with no `ORDER BY`/`CASE` of its own; this
 * function is the only place the precedence rule is expressed, exactly as
 * for a single resource.
 */
export function decideMany(groupsByOrigin: ReadonlyMap<string, readonly ResolvedGrant[]>): Map<string, Effect> {
  const result = new Map<string, Effect>();
  for (const [origin, grants] of groupsByOrigin) {
    result.set(origin, decide(grants));
  }
  return result;
}

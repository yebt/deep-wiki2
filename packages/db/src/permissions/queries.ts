/**
 * Wires the SQL resolver to packages/core's `can()` through the
 * `GrantLookup` port (design.md — "The permission resolver").
 */
import { can as coreCan, impliedAllowActions, impliedDenyActions, type GrantLookup, type GrantQuery } from '@deep-wiki/core';
import type postgres from 'postgres';
import { resolveGrants } from './resolver';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export function createGrantLookup(sql: SqlExecutor): GrantLookup {
  return (query: GrantQuery) =>
    resolveGrants(sql, {
      resourceId: query.resourceId,
      subjectType: query.subjectType,
      subjectId: query.subjectId,
      // `resolveGrants`'s `allowActions` is the set of a *stored row's own*
      // action values that qualify an ALLOW-effect row for the requested
      // action — that is `impliedDenyActions(requested)` (rank >= requested),
      // because "allow(X) covers actions <= X" (packages/core) means a row
      // granted at X authorises any requested action at or below X's rank.
      // Symmetrically, a DENY-effect row at X blocks a requested action at
      // or above X's rank, i.e. `impliedAllowActions(requested)`
      // (rank <= requested). The two `implied*Actions` names describe the
      // lattice from the STORED grant's point of view; here they are
      // consumed from the REQUEST's point of view, so they cross.
      allowActions: impliedDenyActions(query.action),
      denyActions: impliedAllowActions(query.action),
    });
}

export async function can(sql: SqlExecutor, query: GrantQuery): Promise<boolean> {
  return coreCan(createGrantLookup(sql), query);
}

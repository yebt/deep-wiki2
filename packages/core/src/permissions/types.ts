/**
 * Types for the permission resolver's pure half. See
 * openspec/changes/tenancy-and-permissions/design.md — "The permission
 * resolver" — for the full contract this module implements.
 */

/** The action lattice, ordered from least to most privileged. */
export type Action = 'read' | 'comment' | 'write' | 'manage';

export type Effect = 'allow' | 'deny';

export type SubjectKind = 'user' | 'cell' | 'role' | 'agent';

/**
 * One grant row already collapsed to the two properties precedence needs.
 * `depth` 0 is the resource itself; larger values are further up the
 * ancestor chain. Subject identity has already been resolved away by the
 * SQL half — the fold only ever needs depth and effect.
 */
export interface ResolvedGrant {
  readonly depth: number;
  readonly effect: Effect;
}

export interface GrantQuery {
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
  readonly resourceId: string;
  readonly action: Action;
}

/** The port a SQL adapter implements to supply candidate grants. */
export interface GrantLookup {
  (query: GrantQuery): Promise<readonly ResolvedGrant[]>;
}

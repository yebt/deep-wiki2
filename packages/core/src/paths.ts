/**
 * Pure build/parse/containment helpers for the `nodes.path` materialised
 * ancestry encoding (design.md — "The `nodes` path encoding").
 *
 * Encoding: `/{id}/…/{id}/`, both leading and trailing delimiter, ids
 * (never slugs, which are mutable). The trailing delimiter is what makes
 * prefix containment exact regardless of id format: `/a/b` would
 * prefix-match `/a/bc`, but `/a/b/` cannot match `/a/bc/`.
 *
 * `path` is written only by the `nodes_set_path` database trigger — this
 * module never talks to a database, it only encodes/decodes/tests the
 * string the trigger produces.
 */

export const PATH_DELIMITER = '/';

/** 5 levels max x 37 chars (36-char UUID + delimiter) + 1 leading delimiter. */
export const MAX_PATH_LENGTH = 256;

export function buildPath(ancestorIds: readonly string[]): string {
  return `${PATH_DELIMITER}${ancestorIds.join(PATH_DELIMITER)}${PATH_DELIMITER}`;
}

export function parsePath(path: string): readonly string[] {
  return path.split(PATH_DELIMITER).filter((segment) => segment.length > 0);
}

export function isWithinPathBound(path: string): boolean {
  return path.length <= MAX_PATH_LENGTH;
}

/** Self-inclusive: a node's own path counts as a descendant of itself. */
export function isDescendantPath(ancestorPath: string, candidatePath: string): boolean {
  return candidatePath.startsWith(ancestorPath);
}

/** Strict: excludes the ancestor's own path from its own descendant set. */
export function isStrictDescendantPath(ancestorPath: string, candidatePath: string): boolean {
  return candidatePath !== ancestorPath && isDescendantPath(ancestorPath, candidatePath);
}

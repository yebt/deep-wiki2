export function caseInsensitiveDescendants(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, workspaceId: string, pattern: string) {
  return sql`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND lower(path) LIKE ${pattern}`;
}

export function leakyDescendants(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, workspaceId: string, pattern: string) {
  return sql`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND path LIKE ${pattern}`;
}

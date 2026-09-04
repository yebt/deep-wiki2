export function buildPattern(prefix: string): string {
  return `${prefix}%`;
}

export function query(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, workspaceId: string, pattern: string) {
  return sql`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND path LIKE ${pattern}`;
}

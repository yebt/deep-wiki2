export function suspiciousPattern(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, workspaceId: string) {
  return sql`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND path LIKE '%leaked-suffix'`;
}

export function leakyQuery(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, resourceId: string) {
  return sql`SELECT effect FROM permissions WHERE resource_id = ${resourceId}`;
}

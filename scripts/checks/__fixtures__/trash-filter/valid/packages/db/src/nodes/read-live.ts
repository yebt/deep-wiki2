/** Compliant: reads only the live view, never the base table. */
export async function listLive(sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>) {
  return sql`SELECT * FROM live_nodes WHERE workspace_id = ${1}`;
}

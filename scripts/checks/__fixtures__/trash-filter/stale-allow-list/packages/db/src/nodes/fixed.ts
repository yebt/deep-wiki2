/** Already fixed: reads only the live view, so an ALLOW_LIST entry naming this file is stale. */
export async function listLive(sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>) {
  return sql`SELECT * FROM live_nodes`;
}

/** Still needs its exemption: reads the base table directly, so its ALLOW_LIST entry is not stale. */
export async function leak(sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>, id: string) {
  return sql`SELECT * FROM nodes WHERE id = ${id}`;
}

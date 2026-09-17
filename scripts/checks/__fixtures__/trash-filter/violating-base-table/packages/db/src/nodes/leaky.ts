/** Violates rule 1: reads the base nodes table directly (text spelling). */
export async function leak(sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>, id: string) {
  return sql`SELECT * FROM nodes WHERE id = ${id}`;
}

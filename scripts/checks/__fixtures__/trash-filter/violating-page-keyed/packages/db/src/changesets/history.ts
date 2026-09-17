/** Violates rule 2: reads changeset rows for book history without ever naming a live view. */
export async function history(sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>, bookId: string) {
  return sql`SELECT * FROM changeset WHERE book_id = ${bookId}`;
}

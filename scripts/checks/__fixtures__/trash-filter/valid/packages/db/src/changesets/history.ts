/** Compliant: reads a page-keyed table but also names the live view. */
export async function history(sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>, bookId: string) {
  return sql`
    SELECT changeset.*, live_nodes.title
      FROM changeset
      JOIN live_nodes ON live_nodes.id = changeset.node_id
     WHERE changeset.book_id = ${bookId}
  `;
}

export function leakyInsert(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, sourcePageId: string) {
  return sql`INSERT INTO links (source_page_id) VALUES (${sourcePageId})`;
}

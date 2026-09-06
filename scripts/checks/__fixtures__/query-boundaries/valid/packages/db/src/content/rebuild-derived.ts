export function replaceLinks(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, sourcePageId: string) {
  return sql`DELETE FROM links WHERE source_page_id = ${sourcePageId}`;
}

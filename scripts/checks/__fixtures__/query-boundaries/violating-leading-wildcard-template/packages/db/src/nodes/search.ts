export function buildPattern(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, term: string) {
  // A template literal spelling of the same leading wildcard.
  const pattern = `%${term}%`;
  return sql`SELECT id FROM nodes WHERE title LIKE ${pattern}`;
}

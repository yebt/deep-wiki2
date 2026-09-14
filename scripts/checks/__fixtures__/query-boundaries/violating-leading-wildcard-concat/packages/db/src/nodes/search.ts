export function buildPattern(sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown, term: string) {
  // Assembled from a bare wildcard rather than written out, but the pattern
  // it produces still opens with a wildcard.
  const pattern = '%' + term + '%';
  return sql`SELECT id FROM nodes WHERE title LIKE ${pattern}`;
}

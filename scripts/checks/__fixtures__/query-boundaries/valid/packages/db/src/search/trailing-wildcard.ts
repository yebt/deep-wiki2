// A trailing-only wildcard is sargable and must stay legal, in every
// spelling — a bare '%' appended, a concatenation, and a template literal.
export function prefixPatterns(prefix: string): string[] {
  return [prefix + '%', `${prefix}%`, prefix.concat('%')];
}

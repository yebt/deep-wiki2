// The recorded regression: the barrel, not the crypto-free "./pipeline"
// subpath export.
import { parse } from '@deep-wiki/markdown';

export function fromMarkdown(markdown: string) {
  return parse(markdown);
}

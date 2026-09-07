import { parse } from '@deep-wiki/markdown';

export function fromMarkdown(markdown: string) {
  return parse(markdown);
}

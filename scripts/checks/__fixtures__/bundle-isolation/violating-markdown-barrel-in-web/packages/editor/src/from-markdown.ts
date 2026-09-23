import { parse } from '@deep-wiki/markdown/pipeline';

export function fromMarkdown(markdown: string) {
  return parse(markdown);
}

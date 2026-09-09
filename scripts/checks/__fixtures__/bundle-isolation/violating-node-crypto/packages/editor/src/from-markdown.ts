import { createHash } from 'node:crypto';

export function fromMarkdown(markdown: string) {
  return createHash('sha256').update(markdown).digest('hex');
}

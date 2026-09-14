import { createHash } from 'node:crypto';

export function buildBlockIndex(markdown: string) {
  return createHash('sha256').update(markdown).digest('hex');
}

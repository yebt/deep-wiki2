import { diffBlocks } from '@deep-wiki/markdown';
import { loadContent } from './anchors';

export function run(a: { readonly content: string }, b: { readonly content: string }) {
  return diffBlocks(loadContent(a), loadContent(b));
}
